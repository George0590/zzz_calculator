import { createDriveDiscOptimizerWorkerSession } from "@core/driveDiscOptimizer-core.js"

let session: any = null
let options: any = {}
let running = false
let cutoff = Number.NEGATIVE_INFINITY

self.onmessage = async ({ data }) => {
  if (data.type === "globalCutoff") {
    if (Number.isFinite(data.globalCutoffScore)) cutoff = Math.max(cutoff, data.globalCutoffScore)
    return
  }
  try {
    if (data.type === "init") {
      session = createDriveDiscOptimizerWorkerSession(data.catalog, data.store, data.input)
      options = data.options
      self.postMessage({ type: "ready" })
    } else if (data.type === "task") {
      if (running || !session) throw new Error("Invalid optimizer worker task state.")
      running = true
      if (Number.isFinite(data.globalCutoffScore)) cutoff = Math.max(cutoff, data.globalCutoffScore)
      const result = await session.runTask(data.task, {
        ...options,
        globalCutoffScore: cutoff,
        getGlobalCutoffScore: () => cutoff,
        yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)),
        onProgress: (progress: any) => self.postMessage({ type: "progress", progress }),
      })
      self.postMessage({ type: "taskResult", result })
    }
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) })
  } finally {
    if (data.type === "task") running = false
  }
}
