// Browser transport for the core's existing exact-search task protocol.
// Search partitioning, safe cutoffs and final ordering remain in core/.
export class BrowserParallelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BrowserParallelError"
  }
}

export async function runBrowserParallel(context: any) {
  const { catalog, store, input, options, state, parallelTasks, workerCount, hooks } = context
  const startedAt = Date.now()
  const workers: Worker[] = []
  const completed = Array.from({ length: workerCount }, () => ({}))
  const current = Array.from({ length: workerCount }, () => ({}))
  const currentResults: any[][] = Array.from({ length: workerCount }, () => [])
  const best: any[] = []
  let cutoff = context.parallelPrewarmCutoffScore
  let nextTask = 0
  let done = 0
  let lastProgressAt = 0
  const stats = () => ({
    browserWorkerCount: workerCount,
    parallelTaskCount: parallelTasks.length,
    completedTaskCount: done,
    globalCutoffScore: cutoff,
    parallelPrewarmMs: context.parallelPrewarmMs,
    parallelPrewarmCutoffScore: context.parallelPrewarmCutoffScore,
  })
  const metrics = (status: string) => hooks.combineParallelMetrics(
    state.metrics,
    completed.map((value, i) => hooks.mergeParallelMetricSnapshots(value, current[i])),
    startedAt, status, stats(),
  )
  const emit = (status = "running") => {
    const now = Date.now()
    if (status !== "complete" && now - lastProgressAt < (options.progressIntervalMs ?? 200)) return
    lastProgressAt = now
    const snapshot = metrics(status)
    const ranking: any[] = []
    for (const row of [...best, ...currentResults.flat()]) hooks.insertTopResult(ranking, row)
    options.onProgress?.({
      status, settings: state.settings, metrics: snapshot,
      evaluated: hooks.processedCombinationCount(snapshot),
      estimatedCombinationCount: snapshot.estimatedCombinationCount,
      percent: hooks.percentForMetrics(snapshot, status),
      currentResults: ranking.map((row, index) => ({
        rank: index + 1, score: row.score, driveDiscs: row.driveDiscs,
        fourPieceSetId: state.settings.fourPieceSetId,
      })),
    })
  }
  const updateCutoff = (value: any) => {
    const score = hooks.finiteScoreOrNegativeInfinity(value)
    if (score <= cutoff) return
    cutoff = score
    for (const worker of workers) worker.postMessage({ type: "globalCutoff", globalCutoffScore: cutoff })
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const lastMessageAt = Array.from({ length: workerCount }, () => Date.now())
    const cleanup = () => {
      clearInterval(timer)
      for (const worker of workers) worker.terminate()
    }
    const fail = (error: Error, recoverable = true) => {
      if (settled) return
      settled = true
      cleanup()
      reject(!recoverable || error instanceof hooks.OptimizerCancelledError ? error : new BrowserParallelError(error.message))
    }
    const timer = setInterval(() => {
      if (options.shouldCancel?.()) fail(new hooks.OptimizerCancelledError())
      else if (lastMessageAt.some(time => Date.now() - time > 30_000)) {
        fail(new Error("Browser optimizer worker stopped responding."))
      }
    }, 100)
    const assign = (worker: Worker, index: number) => {
      if (nextTask < parallelTasks.length) {
        worker.postMessage({ type: "task", task: parallelTasks[nextTask++], globalCutoffScore: cutoff })
      } else {
        // An idle worker is not stalled while other workers finish their tasks.
        lastMessageAt[index] = Number.POSITIVE_INFINITY
      }
    }
    try {
      for (let index = 0; index < workerCount; index++) {
        const worker = new Worker(new URL("./optimizer-task.worker.ts", import.meta.url), { type: "module" })
        workers.push(worker)
        worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || "Browser worker failed.")) }
        worker.onmessageerror = () => fail(new Error("Browser worker message could not be decoded."))
        worker.onmessage = ({ data }) => {
          if (settled) return
          try {
            lastMessageAt[index] = Date.now()
            if (data.type === "ready") assign(worker, index)
            else if (data.type === "progress") {
              current[index] = data.progress?.metrics ?? {}
              currentResults[index] = data.progress?.currentResults ?? []
              updateCutoff(data.progress?.metrics?.localCutoffScore)
              emit()
            } else if (data.type === "taskResult") {
              hooks.addParallelMetricSnapshot(completed[index], data.result.metrics)
              current[index] = {}
              currentResults[index] = []
              for (const row of data.result.results) hooks.insertTopResult(best, row)
              if (best.length >= context.resultLimit) updateCutoff(best.at(-1)?.score)
              done++
              if (done === parallelTasks.length) {
                const result = hooks.mergeParallelResults([{ results: best }], state.settings, metrics("complete"), state, catalog)
                emit("complete")
                settled = true
                cleanup()
                resolve(result)
              } else {
                emit()
                assign(worker, index)
              }
            } else if (data.type === "error") fail(new Error(data.error), false)
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        }
        worker.postMessage({ type: "init", catalog, store, input: {
          ...input, settings: { ...input.settings, algorithm: "exact-super-bound", disableParallel: true },
        }, options: {
          chunkSize: options.chunkSize ?? 5000,
          progressIntervalMs: options.progressIntervalMs ?? 200,
          yieldIntervalMs: options.yieldIntervalMs ?? 50,
        } })
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
