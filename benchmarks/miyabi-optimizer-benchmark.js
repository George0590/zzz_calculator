import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscsAsync } from "../backend/driveDiscOptimizer.js"
import { miyabiOptimizerFixture } from "../tests/fixtures/miyabi-optimizer.js"

const catalog = await loadCalculatorContext(fileURLToPath(new URL("../", import.meta.url)))
const { input, store } = miyabiOptimizerFixture(catalog, Number(process.env.MIYABI_VARIANTS || 4))
let reference
for (let round = 0; round < Number(process.env.MIYABI_RUNS || 3); round++) {
    for (const workerCount of round % 2 ? [4, 1] : [1, 4]) {
        const start = performance.now()
        let lastReport = start
        console.error(`Starting round ${round + 1}, workers=${workerCount}, discs=${store.driveDiscs.length}`)
        const result = await optimizeDriveDiscsAsync(catalog, store, {
            ...input, settings: { ...input.settings, workerCount, parallelThreshold: 0, disableParallel: workerCount === 1 },
        }, {
            onProgress: progress => {
                if (performance.now() - lastReport < 10_000) return
                lastReport = performance.now()
                console.error(JSON.stringify({ workerCount, status: progress.status, percent: progress.percent, elapsedMs: lastReport - start }))
            },
        })
        const elapsedMs = performance.now() - start
        const top = result.results.map(row => ({ ids: row.driveDiscIdsBySlot, score: row.score }))
        reference ??= top
        assert.deepEqual(top.map(row => row.ids), reference.map(row => row.ids))
        top.forEach((row, index) => assert.ok(Math.abs(row.score - reference[index].score) <= Math.max(1, Math.abs(reference[index].score)) * 1e-10))
        console.log(JSON.stringify({ round, workerCount, elapsedMs, combinations: result.metrics.estimatedCombinationCount,
            scalarCalls: result.metrics.objectiveScalarCalls, suffixCalls: result.metrics.suffixFrontierScoreCalls, top10Matches: true }))
    }
}
