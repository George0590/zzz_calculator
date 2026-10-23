import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const store = JSON.parse(readFileSync(path.join(root, "data/user_drive_discs.json"), "utf8"))
const agent = catalog.agentsMap.get("fioni")
const preferred = agent.preferredDriveDiscs ?? {}
const base = fioniOptimizerInput()
const input = {
    ...base,
    damage: {
        ...base.damage,
        events: (agent.defaultCalculationConfig?.events ?? base.damage.events).map(event => structuredClone(event)),
        selectedEventId: agent.defaultCalculationConfig?.events?.[0]?.id ?? base.damage.selectedEventId,
        skillLevelsByCategory: agent.defaultCalculationConfig?.skillLevelsByCategory ?? base.damage.skillLevelsByCategory,
    },
    combatBuffs: {
        ...base.combatBuffs,
        activeBuffIds: ["agent:fioni.corePassive", "agent:fioni.additionalAbility", "agent:fioni.skill.release_crit_dmg", "driveDisc4pc:freedom_blues.self"],
    },
    settings: {
        ...base.settings,
        fourPieceSetIds: preferred.defaultSetIds ?? [],
        twoPieceSetIds: preferred.defaultTwoPieceSetIds ?? [],
        mainStatLimits: preferred.mainStatLimits ?? base.settings.mainStatLimits,
        algorithm: "exact-super-bound",
    },
}
const top = result => result.results.map(item => ({
    ids: Object.values(item.driveDiscIdsBySlot),
    score: Number(item.score.toFixed(6)),
}))
const startedSuper = performance.now()
const superBound = optimizeDriveDiscs(catalog, store, input)
const superMs = Math.round(performance.now() - startedSuper)
const m = superBound.metrics
console.log("super", JSON.stringify({
    ms: superMs,
    estimated: m.estimatedCombinationCount,
    evaluated: m.evaluated,
    scored: m.scoredCombinationCount,
    pruned: m.prunedBySuperBound,
    superBoundChecks: m.superBoundChecks,
    releaseIntervalBoundEnabled: m.releaseIntervalBoundEnabled,
    strictExact: m.strictExact,
}))
const startedLegacy = performance.now()
const legacy = optimizeDriveDiscs(catalog, store, {
    ...input,
    settings: { ...input.settings, algorithm: "exact-legacy", enableUpperBoundPruning: false },
})
const legacyMs = Math.round(performance.now() - startedLegacy)
console.log("legacy", JSON.stringify({ ms: legacyMs, estimated: legacy.metrics.estimatedCombinationCount, evaluated: legacy.metrics.evaluated, strictExact: legacy.metrics.strictExact }))
console.log("topMatch", JSON.stringify(top(superBound)) === JSON.stringify(top(legacy)))
