import { test, expect } from "@playwright/test"
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { loadCalculatorContext } from "../../backend/calculator.js"
import { optimizeDriveDiscs } from "../../core/driveDiscOptimizer-core.js"
import { miyabiOptimizerFixture } from "../../tests/fixtures/miyabi-optimizer.js"

const root = fileURLToPath(new URL("../../", import.meta.url))

test("Miyabi browser pool preserves Top 10 and cancels cleanly", async ({ page }) => {
  test.setTimeout(90_000)
  const catalog = await loadCalculatorContext(root)
  const { store, input } = miyabiOptimizerFixture(catalog, 3)
  const truth = optimizeDriveDiscs(catalog, store, { ...input, settings: { ...input.settings, algorithm: "exact-legacy", enableUpperBoundPruning: false } })
  const workerFile = readdirSync(path.join(root, "dist/pages/static/app")).find(name => /^optimizer\.worker-.*\.js$/.test(name))!
  const catalogData = JSON.stringify(catalog, (_key, value) => value instanceof Map ? { testMapEntries: [...value] } : value)
  await page.route("**/__optimizer-performance__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Optimizer regression</title>" }))
  await page.goto("/__optimizer-performance__")
  const observed = await page.evaluate(async ({ workerFile, catalogData, input, store }) => {
    const worker = new Worker(`/static/app/${workerFile}`, { type: "module" })
    const catalog = JSON.parse(catalogData, (_key, value) => value?.testMapEntries ? new Map(value.testMapEntries) : value)
    const progress: any[] = []
    const run = (id: string, overrides: any = {}, cancel = false): Promise<any> => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Optimizer timed out")), 30_000)
      worker.onerror = error => { clearTimeout(timeout); reject(new Error(error.message)) }
      worker.onmessage = ({ data }) => {
        if (data.runId !== id) return
        if (data.type === "progress") {
          progress.push({ id, ...data.job })
          if (cancel && data.job.metrics?.browserWorkerCount > 1) worker.postMessage({ type: "cancel", runId: id })
        }
        if (["complete", "cancelled", "error"].includes(data.type)) {
          clearTimeout(timeout)
          if (data.type === "error") reject(new Error(data.error))
          else resolve(data)
        }
      }
      worker.postMessage({ type: "start", runId: id, store, input: { ...input,
        settings: { ...input.settings, parallelThreshold: 0, workerCount: 2, ...overrides },
      }, settings: { progressIntervalMs: 0, yieldIntervalMs: 1 } })
    })
    worker.postMessage({ type: "init-catalog", catalog })
    try {
      const parallel = await run("parallel")
      const serial = await run("serial", { disableParallel: true })
      const cancelled = await run("cancel", { workerCount: 3 }, true)
      const again = await run("again", { workerCount: 3 })
      return { parallel, serial, cancelled, again, progress }
    } finally { worker.terminate() }
  }, { workerFile, catalogData, input, store })
  for (const run of [observed.parallel, observed.serial, observed.again]) {
    expect(run.result.results.map((row: any) => row.driveDiscIdsBySlot)).toEqual(truth.results.map((row: any) => row.driveDiscIdsBySlot))
    run.result.results.forEach((row: any, index: number) => expect(row.score).toBeCloseTo(truth.results[index].score, 6))
  }
  expect(observed.parallel.result.metrics.browserWorkerCount).toBe(2)
  expect(observed.parallel.result.metrics.parallelFallbackReason).toBeNull()
  expect(observed.cancelled.type).toBe("cancelled")
})

test("blocked task workers fall back to the same serial search", async ({ page }) => {
  const catalog = await loadCalculatorContext(root)
  const { store, input } = miyabiOptimizerFixture(catalog, 2)
  const truth = optimizeDriveDiscs(catalog, store, input)
  const workerFile = readdirSync(path.join(root, "dist/pages/static/app")).find(name => /^optimizer\.worker-.*\.js$/.test(name))!
  const catalogData = JSON.stringify(catalog, (_key, value) => value instanceof Map ? { testMapEntries: [...value] } : value)
  await page.route("**/__optimizer-fallback__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fallback regression</title>" }))
  await page.route("**/optimizer-task.worker-*.js", route => route.abort())
  await page.goto("/__optimizer-fallback__")
  const result = await page.evaluate(async ({ workerFile, catalogData, input, store }) => {
    const worker = new Worker(`/static/app/${workerFile}`, { type: "module" })
    const catalog = JSON.parse(catalogData, (_key, value) => value?.testMapEntries ? new Map(value.testMapEntries) : value)
    try {
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Fallback timeout")), 20_000)
        worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)) }
        worker.onmessage = ({ data }) => {
          if (data.type === "complete") { clearTimeout(timer); resolve(data.result) }
          if (data.type === "error") { clearTimeout(timer); reject(new Error(data.error)) }
        }
        worker.postMessage({ type: "start", runId: "fallback", catalog, store,
          input: { ...input, settings: { ...input.settings, workerCount: 2, parallelThreshold: 0 } },
        })
      })
    } finally { worker.terminate() }
  }, { workerFile, catalogData, input, store })
  expect(result.metrics.parallelFallbackReason).toBeTruthy()
  expect(result.results.map((row: any) => row.driveDiscIdsBySlot)).toEqual(truth.results.map((row: any) => row.driveDiscIdsBySlot))
  result.results.forEach((row: any, index: number) => expect(row.score).toBeCloseTo(truth.results[index].score, 6))
})
