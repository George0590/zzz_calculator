import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { calculateInCombatPanel } from "../core/calculator-core.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(rootDir)

function disc(id, setId, partition, mainStat, subStats = []) {
    return {
        id,
        ownerId: "default",
        setId,
        setName: catalog.driveDiscSetsMap.get(setId)?.name?.zhCN ?? setId,
        partition,
        rarity: "S",
        level: 15,
        maxLevel: 15,
        locked: false,
        equippedBy: null,
        mainStat: { ...mainStat, mode: mainStat.mode ?? "flat", label: mainStat.stat },
        subStats: subStats.map(stat => ({ ...stat, mode: stat.mode ?? "flat", label: stat.stat })),
        source: { type: "test", sequence: Number(id.replace(/\D/g, "")) || 999 },
    }
}

const fioniSet = "phaethons_melody"
const fioniTwoSet = "hormone_punk"
const fioniMainBySlot = {
    1: { stat: "hpFlat", value: 2200 },
    2: { stat: "atkFlat", value: 316 },
    3: { stat: "defFlat", value: 184 },
    4: { stat: "anomalyProficiency", value: 92 },
    5: { stat: "fireDmg", value: 30, mode: "pct" },
    6: { stat: "anomalyMastery", value: 30, mode: "pct" },
}
const fioniAltMainBySlot = {
    1: { stat: "hpFlat", value: 2200 },
    2: { stat: "atkFlat", value: 316 },
    3: { stat: "defFlat", value: 184 },
    4: { stat: "atkPct", value: 30, mode: "pct" },
    5: { stat: "atkPct", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
const fioniWorkerStore = {
    version: 1,
    currentOwnerId: "default",
    owners: [{ id: "default", label: "默认用户" }],
    imports: [],
    driveDiscLoadouts: [],
    driveDiscs: [fioniSet, fioniTwoSet].flatMap((setId, setIndex) =>
        [1, 2, 3, 4, 5, 6].flatMap(slot => [
            disc(`fioni-worker-${setIndex}-${slot}-atk`, setId, slot, fioniAltMainBySlot[slot], [
                { stat: "atkPct", value: 3 + slot + setIndex, mode: "pct" },
                { stat: "anomalyProficiency", value: 9 + slot + setIndex },
                { stat: "penRatio", value: 3 + slot, mode: "pct" },
            ]),
            disc(`fioni-worker-${setIndex}-${slot}-release`, setId, slot, fioniMainBySlot[slot], [
                { stat: "atkPct", value: 3 + slot + setIndex, mode: "pct" },
                slot === 4
                    ? { stat: "penRatio", value: 6 + slot + setIndex, mode: "pct" }
                    : { stat: "anomalyProficiency", value: 9 * (slot + setIndex + 1) },
                { stat: "dmgBonus", value: 3 + slot, mode: "pct" },
            ]),
        ]),
    ),
}

const fioniDefaultConfig = catalog.agentsMap.get("fioni").defaultCalculationConfig
const fioniWorkerInput = {
    agentId: "fioni",
    coreSkillLevel: "F",
    cinemaLevel: 0,
    wEngineId: "zzz_wiki_154",
    wEngineModificationLevel: 1,
    driveDiscs: [],
    combatBuffs: {
        activeBuffIds: [
            "agent:fioni.corePassive",
            "agent:fioni.additionalAbility",
            "agent:fioni.skill.release_crit_dmg",
        ],
    },
    damage: {
        ...fioniDefaultConfig,
        events: [fioniDefaultConfig.events[0]],
        target: {
            defense: 953,
            levelCoefficient: 794,
            resistanceByElement: { fire: 0 },
        },
    },
    settings: {
        objective: "damage",
        algorithm: "exact-super-bound",
        fourPieceSetId: fioniSet,
        twoPieceSetId: fioniTwoSet,
        enableUpperBoundPruning: true,
        disableParallel: true,
        mainStatLimits: catalog.agentsMap.get("fioni").preferredDriveDiscs.mainStatLimits,
    },
}

const runtime = createDriveDiscOptimizerRuntime({ availableParallelism: () => 1, yieldControl: async () => {} })
const result = await runtime.optimizeDriveDiscsAsync(catalog, fioniWorkerStore, fioniWorkerInput)
const legacy = await runtime.optimizeDriveDiscsAsync(catalog, fioniWorkerStore, {
    ...fioniWorkerInput,
    settings: { ...fioniWorkerInput.settings, algorithm: "exact-legacy", enableUpperBoundPruning: false },
})
const m = result.metrics
console.log(JSON.stringify({
    results: result.results.length,
    estimated: m.estimatedCombinationCount,
    scored: m.scoredCombinationCount,
    pruned: m.prunedBySuperBound,
    superBoundChecks: m.superBoundChecks,
    releaseIntervalBoundEnabled: m.releaseIntervalBoundEnabled,
    releaseBoundFallbackReason: m.releaseBoundFallbackReason,
    strictExact: m.strictExact,
    candidateCountsBySlot: m.candidateCountsBySlot,
    topIdsMatch: JSON.stringify(result.results.map(r => r.driveDiscs.map(d => d.id)))
        === JSON.stringify(legacy.results.map(r => r.driveDiscs.map(d => d.id))),
    topScoresMatch: JSON.stringify(result.results.map(r => r.score))
        === JSON.stringify(legacy.results.map(r => r.score)),
    legacyEstimated: legacy.metrics.estimatedCombinationCount,
    legacyScored: legacy.metrics.scoredCombinationCount,
    topScore: result.results[0]?.score,
}))

function fourPieceBuffIds(setId) {
    const set = catalog.driveDiscSetsMap.get(setId)
    const self = set?.fourPiece?.selfBuff
    if (!self) return []
    const hasRules = Array.isArray(self.effects) && self.effects.length > 0
        || Array.isArray(self.stats) && self.stats.length > 0
        || Boolean(self.statsByPhase)
    return hasRules ? [`driveDisc4pc:${setId}.self`] : []
}
let maxError = 0
for (const item of result.results) {
    const core = calculateInCombatPanel(catalog, {
        ...fioniWorkerInput,
        driveDiscs: item.driveDiscs,
        combatBuffs: {
            ...fioniWorkerInput.combatBuffs,
            activeBuffIds: [
                ...fioniWorkerInput.combatBuffs.activeBuffIds,
                ...fourPieceBuffIds(item.fourPieceSetId),
            ],
        },
    })
    maxError = Math.max(maxError, Math.abs(item.score - core.damage.totalFinalDamage))
}
console.log("maxScoreError", maxError)
const top = result.results[0]
const topCore = calculateInCombatPanel(catalog, {
    ...fioniWorkerInput,
    driveDiscs: top.driveDiscs,
    combatBuffs: {
        ...fioniWorkerInput.combatBuffs,
        activeBuffIds: [
            ...fioniWorkerInput.combatBuffs.activeBuffIds,
            ...fourPieceBuffIds(top.fourPieceSetId),
        ],
    },
})
console.log("topEventMultipliers", JSON.stringify({
    anomaly: topCore.damage.events[0].multipliers.anomaly,
    anomalyCritRate: topCore.damage.events[0].multipliers.anomalyCritRate,
    anomalyCritDmg: topCore.damage.events[0].multipliers.anomalyCritDmg,
    score: top.score,
    finalDamage: topCore.damage.totalFinalDamage,
}))
