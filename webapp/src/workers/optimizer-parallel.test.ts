import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserParallelError, runBrowserParallel } from "./optimizer-parallel"

class PoolWorker {
  static instances: PoolWorker[] = []
  static failConstructionAt = -1
  messages: any[] = []
  terminated = false
  onmessage: any
  onerror: any
  onmessageerror: any
  constructor() {
    if (PoolWorker.instances.length === PoolWorker.failConstructionAt) throw new Error("unsupported worker")
    PoolWorker.instances.push(this)
  }
  postMessage(message: any) { this.messages.push(message) }
  terminate() { this.terminated = true }
  emit(data: any) { this.onmessage({ data }) }
}
class Cancelled extends Error {}

function context() {
  return {
    catalog: {}, store: {}, input: {}, options: {}, state: { metrics: {}, settings: {} },
    parallelTasks: [{ taskId: 0 }, { taskId: 1 }, { taskId: 2 }], workerCount: 2,
    parallelPrewarmCutoffScore: -Infinity, resultLimit: 10,
    hooks: { OptimizerCancelledError: Cancelled },
  }
}

describe("browser optimizer pool cleanup", () => {
  beforeEach(() => {
    PoolWorker.instances = []
    PoolWorker.failConstructionAt = -1
    vi.stubGlobal("Worker", PoolWorker)
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it("terminates all children when cancellation is requested", async () => {
    let cancelled = false
    const config = context()
    config.options = { shouldCancel: () => cancelled }
    const pending = runBrowserParallel(config)
    const rejection = expect(pending).rejects.toBeInstanceOf(Cancelled)
    cancelled = true
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(PoolWorker.instances).toHaveLength(2)
    expect(PoolWorker.instances.every(worker => worker.terminated)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cleans up already created workers if pool creation fails", async () => {
    PoolWorker.failConstructionAt = 1
    await expect(runBrowserParallel(context())).rejects.toBeInstanceOf(BrowserParallelError)
    expect(PoolWorker.instances[0]!.terminated).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("preserves calculation errors instead of classifying them as a recoverable pool failure", async () => {
    const pending = runBrowserParallel(context())
    PoolWorker.instances[0]!.emit({ type: "error", error: "invalid calculation" })
    await expect(pending).rejects.not.toBeInstanceOf(BrowserParallelError)
    expect(PoolWorker.instances.every(worker => worker.terminated)).toBe(true)
  })

  it("stops the whole pool on decoding failure or unresponsive workers", async () => {
    const failed = runBrowserParallel(context())
    PoolWorker.instances[0]!.onmessageerror()
    await expect(failed).rejects.toBeInstanceOf(BrowserParallelError)
    expect(PoolWorker.instances.every(worker => worker.terminated)).toBe(true)
    const stalled = runBrowserParallel(context())
    const rejection = expect(stalled).rejects.toBeInstanceOf(BrowserParallelError)
    await vi.advanceTimersByTimeAsync(30_100)
    await rejection
    expect(PoolWorker.instances.every(worker => worker.terminated)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
