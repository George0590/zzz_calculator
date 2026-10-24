// Diagnostic probe: proves which optimizer code path disables super-bound pruning for fioni.
// Run with: node --import ./tmp/fioni-engine-instrument-register.mjs tmp/fioni-engine-diag.mjs
// Requires tmp/fioni-engine-instrument-loader.mjs (in-memory patch of core/driveDiscOptimizer-core.js;
// repository sources are not modified).
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"
import { velinaOptimizerStore, velinaOptimizerInput } from "../tests/fixtures/velina-optimizer.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(rootDir)

const fourSet = "phaethons_melody"
const twoSet = "hormone_punk"
const slotMain = {
    1: { stat: "hpFlat", value: 2200 },
    2: { stat: "atkFlat", value: 316 },
    3: { stat: "defFlat", value: 184 },
    4: { stat: "anomalyProficiency", value: 92 },
    5: { stat: "fireDmg", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
const subStatPool = ["atkPct", "anomalyProficiency", "penFlat", "atkFlat", "critRate", "critDmg"]

function disc(id, setId, partition, variant) {
    return {
        id, ownerId: "default", setId,
        setName: catalog.driveDiscSetsMap.get(setId)?.name?.zhCN ?? setId,
        partition, rarity: "S", level: 15, maxLevel: 15, locked: false, equippedBy: null,
        mainStat: { ...slotMain[partition], label: slotMain[partition].stat },
        subStats: Array.from({ length: 4 }, (_, index) => {
            const stat = subStatPool[(variant + index + partition) % subStatPool.length]
            const value = stat === "atkPct" ? 3 + ((variant + partition) % 5) * 1.5
                : stat === "anomalyProficiency" ? 9 + ((variant + partition) % 5) * 9
                    : stat === "penFlat" ? 6 + ((variant + partition) % 5) * 3
                        : stat === "atkFlat" ? 19 + ((variant + partition) % 5) * 19
                            : stat === "critRate" ? 2.4 + ((variant + partition) % 4) * 1.2
                                : 4.8 + ((variant + partition) % 5) * 2.4
            return { stat, value, label: stat }
        }),
        source: { type: "probe", sequence: Number(id.replace(/\D/g, "")) || 999 },
    }
}

function fioniStore(variants) {
    const driveDiscs = []
    for (const slot of [1, 2, 3, 4, 5, 6]) {
        for (let variant = 0; variant < variants; variant += 1) {
            driveDiscs.push(disc(`f${slot}-${variant}`, fourSet, slot, variant))
            driveDiscs.push(disc(`h${slot}-${variant}`, twoSet, slot, variant + variants))
        }
    }
    return { version: 1, owners: [{ id: "default", label: "默认用户" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

const attributeDamage = {
    mode: "custom", agentLevel: 60, skillLevelsByCategory: { basic: 12, chain: 12 },
    selectedEventId: "attribute",
    events: [{ id: "attribute", kind: "anomaly", settlementType: "attribute", anomalyEffect: "burn", count: 1, stunned: true, critMode: "expected" }],
}

function fioniInput({ activeBuffIds = null, damage = null } = {}) {
    const base = fioniOptimizerInput()
    return {
        ...base,
        combatBuffs: {
            ...base.combatBuffs,
            activeBuffIds: activeBuffIds ?? base.combatBuffs.activeBuffIds,
        },
        damage: damage ?? base.damage,
        settings: { ...base.settings, algorithm: "exact-super-bound", enableObjectiveScalarKernel: true },
    }
}

function runCase(label, store, input) {
    globalThis.__FIONI_OPT_DBG = undefined
    const started = performance.now()
    const result = optimizeDriveDiscs(catalog, store, input)
    const elapsedMs = performance.now() - started
    const m = result.metrics ?? {}
    const dbg = globalThis.__FIONI_OPT_DBG ?? {}
    const kernelInfo = (dbg.kernelInfo ?? []).slice(0, 6)
    console.log(JSON.stringify({
        label,
        elapsedMs: Math.round(elapsedMs),
        estimated: m.estimatedCombinationCount,
        evaluated: m.evaluated,
        scored: m.scoredCombinationCount,
        prunedSuper: m.prunedBySuperBound,
        superBoundChecks: m.superBoundChecks,
        pruneCalls: dbg.pruneCalls,
        pruneCallsWithFiniteCutoff: dbg.pruneCallsWithFiniteCutoff,
        boundInfinityReleaseInterval: dbg.boundInfinityReleaseInterval,
        boundInfinityFreeTwoPiece: dbg.boundInfinityFreeTwoPiece,
        requiresReleaseIntervalBound: dbg.meta?.requiresReleaseIntervalBound ?? null,
        strictMonotonic: dbg.meta?.strictMonotonic ?? null,
        scoreKernel: m.scoreKernel,
        specializedScoreCalls: m.specializedScoreCalls,
        specializedScoreFallbacks: m.specializedScoreFallbacks,
        objectiveScalarCalls: m.objectiveScalarCalls,
        objectiveScalarFallbacks: m.objectiveScalarFallbacks,
        kernelSamples: kernelInfo,
        top1: result.results?.[0]?.score,
    }, null, 1))
}

const base = fioniOptimizerInput()
const allBuffs = base.combatBuffs.activeBuffIds
const noCore = allBuffs.filter(id => id !== "agent:fioni.corePassive")
const store2 = fioniStore(2)

runCase("fioni release + corePassive(默认夹具, 960组合)", store2, fioniInput())
runCase("fioni release + 去掉corePassive, 960组合", store2, fioniInput({ activeBuffIds: noCore }))
runCase("fioni attribute异常(无release) + corePassive, 960组合", store2, fioniInput({ damage: attributeDamage }))
runCase("对照 velina release, 960组合", velinaOptimizerStore({ variants: 2 }), {
    ...velinaOptimizerInput(),
    settings: { ...velinaOptimizerInput().settings, algorithm: "exact-super-bound" },
})
