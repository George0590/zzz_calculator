import { expect, test } from "@playwright/test"
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../../backend/calculator.js"
import { optimizeDriveDiscs } from "../../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput, fioniOptimizerStore } from "../../tests/fixtures/fioni-optimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("Fioni default release survives editing, save, and reload", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(() => {
    if (sessionStorage.getItem("fioni-seeded")) return
    sessionStorage.setItem("fioni-seeded", "1")
    localStorage.setItem("zzz-calculator.webapp.build.v1", JSON.stringify({
      version: 2,
      currentOwnerId: "default",
      byOwner: { default: { currentAgentId: "fioni", byAgent: { fioni: {} } } },
    }))
  })
  await page.goto("/")
  await expect(page.locator("body")).toContainText("菲欧妮")
  await page.getByTestId("open-calculation-config").click()
  await expect(page.locator("body")).toContainText("445%")
  await page.locator('[aria-label="计算方式"] .n-base-selection').click()
  await page.locator(".n-base-select-option:visible").filter({ hasText: "自定义" }).click()
  const source = page.locator('[aria-label="菲欧妮异放来源"]')
  await expect(source).toBeVisible()
  await source.locator(".n-base-selection").click()
  await page.locator(".n-base-select-option:visible").filter({ hasText: "烬火追魂" }).click()
  await expect(page.locator("body")).toContainText("597%")
  await page.getByRole("button", { name: "保存配置", exact: true }).click()
  await page.reload()
  await page.getByTestId("open-calculation-config").click()
  await expect(page.locator('[aria-label="菲欧妮异放来源"]')).toContainText("烬火追魂")
  await expect(page.locator("body")).toContainText("597%")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("fioni-workbench.png"), fullPage: true })
})

test("Fioni maintenance roundtrip keeps the authored release binding", async ({ page, request }, testInfo) => {
  test.skip(!path.basename(process.env.ZZZ_CALCULATOR_DATA_DIR || "").startsWith("zzz-agent-browser-"), "Requires a disposable maintenance catalog")
  test.setTimeout(60_000)
  const read = async () => (await (await request.get("/api/maintenance/catalog")).json()).data
  const original = (await read()).agents.agents.find((agent: any) => agent.id === "fioni")
  try {
    await page.goto("/maintenance")
    await page.locator(".record-option").filter({ hasText: "菲欧妮" }).click()
    await expect(page.locator(".maintenance-editor-head")).toContainText("菲欧妮")
    await expect(page.locator(".anomaly-release-profiles")).toContainText("焚罪异放")
    await expect(page.locator(".anomaly-release-profiles")).toContainText("来源技能异放倍率")
    await page.getByRole("button", { name: "管理默认循环", exact: true }).click()
    const name = page.locator(".maintenance-field").filter({ has: page.getByText("方案名称", { exact: true }) }).locator("input")
    await expect(name).toHaveValue("单次焚罪异放")
    await name.fill("单次焚罪异放浏览器回读")
    await page.getByRole("button", { name: "应用", exact: true }).click()
    const pending = page.waitForResponse(response => response.url().endsWith("/api/maintenance/agents") && response.request().method() === "POST")
    await page.getByRole("button", { name: "保存", exact: true }).first().click()
    expect((await pending).ok()).toBe(true)
    await expect(page.locator(".maintenance-save-strip")).toContainText("完整目录已刷新")
    await page.reload()
    await page.locator(".record-option").filter({ hasText: "菲欧妮" }).click()
    await page.getByRole("button", { name: "管理默认循环", exact: true }).click()
    await expect(page.locator(".maintenance-field").filter({ has: page.getByText("方案名称", { exact: true }) }).locator("input")).toHaveValue("单次焚罪异放浏览器回读")
    const current = (await read()).agents.agents.find((agent: any) => agent.id === "fioni")
    expect(current.anomalyReleaseProfiles.find((profile: any) => profile.id === "fioni_purifying_flame_release").releaseSkillRef).toMatchObject({ agentSkillId: "fioni", categoryId: "basic", rowId: "release" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("fioni-maintenance.png"), fullPage: true })
  } finally {
    const data = await read()
    await request.post("/api/maintenance/agents", { headers: { "If-Match": `"${data.agentRevisions.fioni}"` }, data: original })
  }
})

test("built Worker matches the Fioni optimizer oracle", async ({ page }) => {
  test.setTimeout(90_000)
  const asset = readdirSync(path.join(root, "dist/pages/static/app")).find(name => /^optimizer\.worker-.*\.js$/.test(name))!
  const catalog = await loadCalculatorContext(root)
  const serialized = JSON.stringify(catalog, (_key, value) => value instanceof Map ? { mapEntries: [...value] } : value)
  const input = fioniOptimizerInput()
  const store = fioniOptimizerStore()
  const truth = optimizeDriveDiscs(catalog, store, { ...input, settings: { ...input.settings, algorithm: "exact-legacy", enableUpperBoundPruning: false } })
  await page.route("**/__fioni_worker__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fioni Worker</title>" }))
  await page.goto("/__fioni_worker__")
  const result = await page.evaluate(async ({ url, serialized, input, store }) => {
    const worker = new Worker(url, { type: "module" })
    const catalog = JSON.parse(serialized, (_key, value) => value?.mapEntries ? new Map(value.mapEntries) : value)
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Worker timeout")), 30_000)
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)) }
      worker.onmessage = event => {
        if (event.data.type === "complete") { clearTimeout(timer); resolve(event.data.result) }
        if (event.data.type === "error") { clearTimeout(timer); reject(new Error(event.data.error)) }
      }
      worker.postMessage({ type: "init-catalog", catalog, catalogKey: "fioni-e2e" })
      worker.postMessage({ type: "start", runId: "fioni-worker", input, store, settings: { yieldIntervalMs: 0, progressIntervalMs: 0 } })
    })
    worker.terminate()
    return result
  }, { url: `/static/app/${asset}`, serialized, input, store })
  expect(result.results.map((item: any) => item.driveDiscIdsBySlot)).toEqual(truth.results.map(item => item.driveDiscIdsBySlot))
  result.results.forEach((item: any, index: number) => expect(item.score).toBeCloseTo(truth.results[index].score, 6))
})
