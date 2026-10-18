import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs, optimizeDriveDiscsAsync } from "../backend/driveDiscOptimizer.js"
import { miyabiOptimizerFixture } from "./fixtures/miyabi-optimizer.js"

const catalog = await loadCalculatorContext(fileURLToPath(new URL("../", import.meta.url)))
const { input, store } = miyabiOptimizerFixture(catalog, 6)
const serial = optimizeDriveDiscs(catalog, store, { ...input, settings: { ...input.settings, disableParallel: true } })
assert.equal(serial.metrics.scoreKernel, "compiled-dense", "Generic microprobe timing must not disable a validated fixed-set scoring path")
const parallel = await optimizeDriveDiscsAsync(catalog, store, { ...input, settings: { ...input.settings, workerCount: 4, parallelThreshold: 0 } })
const ids = result => result.results.map(row => row.driveDiscs.map(disc => disc.id))
assert.deepEqual(ids(serial), ids(parallel), "Long serial traversal must preserve tied results found by independent parallel tasks")

// These tied candidates were incorrectly pruned after subtract/add drift of
// -5.4e-12 in the accumulated stats pushed their upper bound below the cutoff.
assert.deepEqual(ids(serial)[7], ["fixture-1-0-5", "fixture-2-3-4", "fixture-3-3-0", "fixture-4-0-2", "fixture-5-0-1", "fixture-6-0-0"])
assert.deepEqual(ids(serial)[8], ["fixture-1-0-5", "fixture-2-3-4", "fixture-3-3-0", "fixture-4-0-2", "fixture-5-0-1", "fixture-6-0-1"])
const truth = optimizeDriveDiscs(catalog, store, { ...input, settings: { ...input.settings, algorithm: "exact-legacy", enableUpperBoundPruning: false } })
assert.deepEqual(ids(serial), ids(truth), "Top 10 must match exhaustive search including stable ties")
serial.results.forEach((row, index) => {
    assert.ok(Math.abs(row.score - truth.results[index].score) < 1e-6)
    assert.ok(Math.abs(row.score - parallel.results[index].score) < 1e-6)
})
assert.ok(Number.isFinite(parallel.metrics.objectiveScalarCalls) && parallel.metrics.objectiveScalarCalls > 0)
console.log(`Miyabi exact/parallel/exhaustive Top 10 passed (${serial.metrics.estimatedCombinationCount} combinations)`)
