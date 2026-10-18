import { createDriveDiscOptimizerRuntime } from "@core/driveDiscOptimizer-core.js"
import { BrowserParallelError, runBrowserParallel } from "./optimizer-parallel"

const browserOptimizerRuntime = createDriveDiscOptimizerRuntime({
  yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)),
  availableParallelism: () => navigator.hardwareConcurrency || 2,
  maxWorkerCount: 4,
  runParallel: runBrowserParallel,
})

let activeRunId = ""
let cancelRequested = false
let cachedCatalog: any = null
let cachedCatalogKey = ""
// One completed request only; never persist inventory or partial search results.
let completedRequest: { key: string; result: any } | null = null

function post(type: string, payload: Record<string, any> = {}) {
  self.postMessage({
    type,
    ...payload,
  })
}

function normalizeWorkerInput(input: any = {}) {
  const algorithm = input.settings?.algorithm === "exact-super-bound-parallel"
    ? "exact-super-bound"
    : input.settings?.algorithm
  return {
    ...input,
    settings: {
      ...(input.settings ?? {}),
      algorithm: algorithm ?? "exact-super-bound",
      disableParallel: input.settings?.disableParallel === true,
      workerCount: input.settings?.workerCount
        ? Math.max(1, Math.min(4, Number(input.settings.workerCount))) : undefined,
    },
  }
}

self.onmessage = async event => {
  const message = event.data ?? {}
  if (message.type === "init-catalog") {
    completedRequest = null
    cachedCatalog = message.catalog
    cachedCatalogKey = String(message.catalogKey ?? "")
    post("catalog-ready", { catalogKey: cachedCatalogKey })
    return
  }
  if (message.catalog) {
    completedRequest = null
    cachedCatalog = message.catalog
    cachedCatalogKey = String(message.catalogKey ?? cachedCatalogKey)
  }
  const catalog = cachedCatalog
  if (message.type === "cancel") {
    if (!message.runId || message.runId === activeRunId) {
      cancelRequested = true
    }
    return
  }

  if (message.type === "preview") {
    try {
      if (!catalog) {
        throw new Error("Optimizer catalog is not initialized.")
      }
      const preview = browserOptimizerRuntime.createJob(catalog, message.store, normalizeWorkerInput(message.input)).preview()
      post("preview", { runId: message.runId, preview })
    } catch (error) {
      post("error", { runId: message.runId, error: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (message.type !== "start") {
    return
  }

  activeRunId = message.runId
  cancelRequested = false
  const startedAt = Date.now()
  const input = normalizeWorkerInput(message.input)
  try {
    if (!catalog) {
      throw new Error("Optimizer catalog is not initialized.")
    }
    const requestKey = JSON.stringify({ input, store: message.store })
    if (message.settings?.reuseResult !== false && completedRequest?.key === requestKey) {
      const result = { ...completedRequest.result, metrics: { ...completedRequest.result.metrics, cacheHit: true } }
      post("progress", { runId: message.runId, job: {
        status: "complete", metrics: result.metrics, settings: result.settings,
        evaluated: result.metrics.processedCombinationCount,
        estimatedCombinationCount: result.metrics.estimatedCombinationCount, percent: 100, elapsedMs: 0,
      } })
      post("complete", { runId: message.runId, result, job: { status: "complete", elapsedMs: 0 } })
      return
    }
    post("started", {
      runId: message.runId,
      job: {
        status: "preparing",
        elapsedMs: 0,
      },
    })

    const job = browserOptimizerRuntime.createJob(catalog, message.store, input, {
      onProgress: (progress: any) => {
        post("progress", {
          runId: message.runId,
          job: {
            status: progress.status ?? "preparing",
            ...progress,
            elapsedMs: Date.now() - startedAt,
          },
        })
      },
    })
    const preview = job.preview()
    post("preview", {
      runId: message.runId,
      job: {
        status: "preview",
        ...preview,
        evaluated: 0,
        estimatedCombinationCount: preview.metrics?.estimatedCombinationCount ?? 0,
        percent: 0,
        elapsedMs: Date.now() - startedAt,
      },
    })

    const runOptions = {
      chunkSize: 5000,
      progressIntervalMs: message.settings?.progressIntervalMs ?? 200,
      yieldIntervalMs: message.settings?.yieldIntervalMs ?? 50,
      shouldCancel: () => cancelRequested,
      onProgress: (progress: any) => {
        post("progress", {
          runId: message.runId,
          job: {
            status: progress.status ?? "running",
            ...progress,
            elapsedMs: Date.now() - startedAt,
          },
        })
      },
    }
    let result
    try {
      result = await job.run(runOptions)
    } catch (error) {
      if (cancelRequested || !(error instanceof BrowserParallelError)) throw error
      // A browser may reject nested module workers or run out of resources.
      // Retry the same search space serially after the pool has been terminated.
      const serialInput = { ...input, settings: { ...input.settings, disableParallel: true } }
      result = await browserOptimizerRuntime.createJob(catalog, message.store, serialInput, runOptions).run(runOptions)
      result.metrics.parallelFallbackReason = error instanceof Error ? error.message : String(error)
    }
    if (!cancelRequested && !result.error?.isError) completedRequest = { key: requestKey, result }
    post(cancelRequested ? "cancelled" : "complete", {
      runId: message.runId,
      result,
      job: {
        status: cancelRequested ? "cancelled" : "complete",
        result,
        settings: result.settings,
        metrics: result.metrics,
        elapsedMs: Date.now() - startedAt,
      },
    })
  } catch (error) {
    post(cancelRequested ? "cancelled" : "error", {
      runId: message.runId,
      error: error instanceof Error ? error.message : String(error),
      job: {
        status: cancelRequested ? "cancelled" : "error",
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      },
    })
  } finally {
    if (activeRunId === message.runId) {
      activeRunId = ""
      cancelRequested = false
    }
  }
}
