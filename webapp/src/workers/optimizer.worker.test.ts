import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({ createJob: vi.fn(), run: vi.fn(), options: null as any }))
vi.mock("@core/driveDiscOptimizer-core.js", () => ({
  createDriveDiscOptimizerRuntime: (options: any) => { runtime.options = options; return runtime },
}))

describe("browser optimizer worker", () => {
  let posts: any[]
  const result = () => ({ results: [{ rank: 1, score: 100, driveDiscs: [] }], settings: {}, metrics: {
    processedCombinationCount: 100, estimatedCombinationCount: 100,
  }, error: { isError: false } })
  const send = (data: any) => (self.onmessage as any)({ data })
  const start = (extra: any = {}) => send({ type: "start", runId: "run", store: { driveDiscs: [] }, input: { agentId: "a" }, ...extra })

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    posts = []
    vi.stubGlobal("postMessage", (message: any) => posts.push(message))
    runtime.run.mockImplementation(async () => result())
    runtime.createJob.mockImplementation(() => ({ preview: () => ({ metrics: {} }), run: runtime.run }))
    await import("./optimizer.worker")
    await send({ type: "init-catalog", catalog: { version: 1 } })
  })
  afterEach(() => { self.onmessage = null; vi.unstubAllGlobals() })

  it("reuses only the last completed identical request", async () => {
    await start()
    await start({ runId: "again" })
    expect(runtime.run).toHaveBeenCalledTimes(1)
    expect(posts.at(-1).result.metrics.cacheHit).toBe(true)
    expect(posts.at(-1).job.elapsedMs).toBe(0)
    await start({ input: { agentId: "other" } })
    await start()
    expect(runtime.run).toHaveBeenCalledTimes(3)
  })

  it.each([
    { input: { agentId: "a", combatBuffs: { activeBuffIds: ["buff"] } } },
    { input: { agentId: "a", damage: { events: [{ count: 2 }] } } },
    { input: { agentId: "a", enemy: { defense: 100 } } },
    { input: { agentId: "a", settings: { minimums: { critRate: 80 } } } },
    { input: { agentId: "a", settings: { mainStatLimits: { 4: ["atkPct"] } } } },
    { input: { agentId: "a", ownerId: "other" } },
    { store: { driveDiscs: [{ id: "d", reservedForAgentId: "other" }] } },
    { store: { driveDiscs: [{ id: "d", subStats: [{ stat: "critRate", value: 4.8 }] }] } },
    { catalog: { version: 2 } },
  ])("invalidates changed calculation data: %j", async change => {
    await start()
    await start(change)
    expect(runtime.run).toHaveBeenCalledTimes(2)
  })

  it("does not cache errors or cancelled searches", async () => {
    runtime.run.mockResolvedValueOnce({ ...result(), error: { isError: true } })
    await start()
    runtime.run.mockImplementationOnce(async () => { await send({ type: "cancel", runId: "run" }); return result() })
    await start()
    expect(posts.at(-1).type).toBe("cancelled")
    await start()
    expect(runtime.run).toHaveBeenCalledTimes(3)
    expect(posts.at(-1).result.metrics.cacheHit).not.toBe(true)
  })

  it("caps parallelism and keeps explicit serial mode", async () => {
    expect(runtime.options.maxWorkerCount).toBe(4)
    expect(typeof runtime.options.runParallel).toBe("function")
    await start({ input: { settings: { workerCount: 12 } } })
    expect(runtime.createJob.mock.calls[0]?.[2].settings).toMatchObject({ workerCount: 4, disableParallel: false })
    await start({ input: { settings: { disableParallel: true } } })
    expect(runtime.createJob.mock.calls[1]?.[2].settings.disableParallel).toBe(true)
  })

  it("falls back only on pool errors, preserving the entire input", async () => {
    const { BrowserParallelError } = await import("./optimizer-parallel")
    runtime.run.mockRejectedValueOnce(new BrowserParallelError("worker unavailable"))
    await start({ input: { agentId: "a", settings: { minimums: { critRate: 80 } } } })
    expect(runtime.createJob.mock.calls[1]?.[2]).toMatchObject({ agentId: "a", settings: { disableParallel: true, minimums: { critRate: 80 } } })
    expect(posts.at(-1).result.metrics.parallelFallbackReason).toBe("worker unavailable")
    runtime.run.mockRejectedValueOnce(new Error("invalid formula"))
    await start({ input: { agentId: "bad" } })
    expect(posts.at(-1).type).toBe("error")
    expect(runtime.run).toHaveBeenCalledTimes(3)
  })
})
