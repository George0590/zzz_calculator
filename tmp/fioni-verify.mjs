import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext, createInCombatPanelCalculator } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput, fioniOptimizerStore } from "../tests/fixtures/fioni-optimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const input = fioniOptimizerInput()
const store = fioniOptimizerStore()

const panel = createInCombatPanelCalculator(catalog, input)
const meta = panel.optimizerStatMetadata()
const statIds = meta.relevantStatIds
const dense = panel.compileDensePanelScoreTarget({ statIds, setIds: [], setIndexById: new Map() })
const fixed = dense.compileForSetCounts([])
console.log("metadata", JSON.stringify({ strictMonotonic: meta.strictMonotonic, requiresReleaseIntervalBound: meta.requiresReleaseIntervalBound }))
console.log("kernel", JSON.stringify({
    scoreKernel: fixed.scoreKernel,
    releaseIntervalBound: fixed.releaseIntervalBound,
    releaseIntervalBoundReason: fixed.releaseIntervalBoundReason,
    hasObjectiveScalar: typeof fixed.scoreObjectiveScalar,
    hasCombinedScalar: typeof fixed.scoreCombinedScalar,
}))

const superBound = optimizeDriveDiscs(catalog, store, input)
const legacy = optimizeDriveDiscs(catalog, store, { ...input, settings: { ...input.settings, algorithm: "exact-legacy", enableUpperBoundPruning: false } })
const m = superBound.metrics
console.log("super", JSON.stringify({
    elapsedMs: Math.round(m.elapsedMs ?? 0),
    estimated: m.estimatedCombinationCount,
    evaluated: m.evaluated,
    scored: m.scoredCombinationCount,
    pruned: m.prunedBySuperBound,
    superBoundChecks: m.superBoundChecks,
    releaseIntervalBoundEnabled: m.releaseIntervalBoundEnabled,
    releaseBoundFallbackReason: m.releaseBoundFallbackReason,
    objectiveScalarFallbackReason: m.objectiveScalarFallbackReason,
    strictExact: m.strictExact,
}))
const top = result => result.results.map(item => ({ ids: Object.values(item.driveDiscIdsBySlot), score: Number(item.score.toFixed(6)) }))
console.log("topMatch", JSON.stringify(top(superBound)) === JSON.stringify(top(legacy)))
console.log("legacy", JSON.stringify({ elapsedMs: Math.round(legacy.metrics.elapsedMs ?? 0), evaluated: legacy.metrics.evaluated }))
