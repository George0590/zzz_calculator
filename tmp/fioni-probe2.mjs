import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext, createInCombatPanelCalculator } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput, fioniOptimizerStore } from "../tests/fixtures/fioni-optimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)

// ---------- 1. metadata / kernel introspection for Fioni variants ----------
function inspect(label, payload) {
    const p = createInCombatPanelCalculator(catalog, payload)
    const meta = p.optimizerStatMetadata()
    const statIds = ["atkPct", "anomalyProficiency", "anomalyMastery", "fireDmg", "penRatio", "atkFlat"]
    const dense = p.compileDensePanelScoreTarget({ statIds, setIds: [], setIndexById: new Map() })
    const fixed = dense?.compileForSetCounts(new Int16Array())
    console.log(JSON.stringify({
        label,
        strictMonotonic: meta?.strictMonotonic,
        requiresReleaseIntervalBound: meta?.requiresReleaseIntervalBound,
        relevantStatIds: meta?.relevantStatIds,
        denseKernel: dense?.scoreKernel,
        fixedKernel: fixed?.scoreKernel,
        fixedReleaseIntervalBound: fixed?.releaseIntervalBound,
        hasScoreObjectiveScalar: typeof fixed?.scoreObjectiveScalar,
        hasScoreCombinedScalar: typeof fixed?.scoreCombinedScalar,
    }))
}

const base = fioniOptimizerInput()
inspect("fioni default (release, core passive)", base)
inspect("fioni release without corePassive buff", {
    ...structuredClone(base),
    combatBuffs: { ...base.combatBuffs, activeBuffIds: base.combatBuffs.activeBuffIds.filter(id => id !== "agent:fioni.corePassive") },
})
inspect("fioni attribute-only event", (() => {
    const p = structuredClone(base)
    p.damage.events = [{ ...p.damage.events[0], settlementType: "attribute", triggerActorRef: undefined }]
    return p
})())
const direct = structuredClone(base)
direct.damage.events = [{ id: "d", kind: "direct", skillMultiplier: 1.2, count: 1, stunned: true, critMode: "expected" }]
inspect("fioni direct-only event", direct)

// ---------- 2. store builder ----------
function disc(id, setId, partition, variant, slotMain) {
    const subStatPool = ["atkPct", "anomalyProficiency", "penFlat", "atkFlat", "critRate", "critDmg"]
    return {
        id, ownerId: "default", setId, setName: setId, partition, rarity: "S", level: 15, maxLevel: 15,
        locked: false, equippedBy: null,
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
        source: { type: "probe", sequence: 1 },
    }
}
const fioniMain = {
    1: { stat: "hpFlat", value: 2200 }, 2: { stat: "atkFlat", value: 316 }, 3: { stat: "defFlat", value: 184 },
    4: { stat: "anomalyProficiency", value: 92 }, 5: { stat: "fireDmg", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
function storeFor(fourSet, twoSet, variants, slotMain) {
    const driveDiscs = []
    for (const slot of [1, 2, 3, 4, 5, 6]) {
        for (let v = 0; v < variants; v += 1) {
            driveDiscs.push(disc(`f${slot}-${v}`, fourSet, slot, v, slotMain))
            driveDiscs.push(disc(`h${slot}-${v}`, twoSet, slot, v + variants, slotMain))
        }
    }
    return { version: 1, owners: [{ id: "default", label: "d" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

function run(label, payload, store) {
    const started = performance.now()
    const r = optimizeDriveDiscs(catalog, store, payload)
    const elapsed = performance.now() - started
    const m = r.metrics ?? {}
    console.log(JSON.stringify({
        label, elapsedMs: Math.round(elapsed),
        estimated: m.estimatedCombinationCount, evaluated: m.evaluated,
        prunedSuperBound: m.prunedBySuperBound, prunedChunk: m.prunedByChunkBound,
        prunedSuffix: m.prunedBySuffixTopKBound, prunedGlobal: m.prunedByGlobalCutoff,
        superBoundChecks: m.superBoundChecks, safeBoundFallbacks: m.safeBoundFallbacks,
        scoreKernel: m.scoreKernel, evalPerSec: Math.round(m.evaluationsPerSecond ?? 0),
        denseScoreMs: Math.round(m.denseScoreMs ?? 0), boundCheckMs: Math.round(m.boundCheckMs ?? 0),
        top1: Math.round(r.results?.[0]?.score ?? 0),
    }))
}

// Fioni baseline vs control agent, same scale (3 variants per set per slot)
const variants = Number(process.env.PROBE_VARIANTS ?? 3)
const fioniStore = storeFor("phaethons_melody", "hormone_punk", variants, fioniMain)
run("fioni release super-bound", base, fioniStore)
run("fioni release legacy(no upper pruning)", { ...base, settings: { ...base.settings, algorithm: "exact-legacy", enableUpperBoundPruning: false } }, fioniStore)
if (process.env.PROBE_SKIP_CONTROL !== "1") {
    const example = catalog.examples.yeShunguang.input
    const woodpeckerMain = {
        1: { stat: "hpFlat", value: 2200 }, 2: { stat: "atkFlat", value: 316 }, 3: { stat: "defFlat", value: 184 },
        4: { stat: "critRate", value: 24, mode: "pct" }, 5: { stat: "electricDmg", value: 30, mode: "pct" },
        6: { stat: "atkPct", value: 30, mode: "pct" },
    }
    const controlStore = storeFor("woodpecker_electro", "hormone_punk", variants, woodpeckerMain)
    const controlInput = {
        ...example,
        combatBuffs: { activeBuffIds: [] },
        settings: { fourPieceSetId: "woodpecker_electro", twoPieceSetId: "hormone_punk", objective: "damage", algorithm: "exact-super-bound" },
    }
    run("yeShunguang direct super-bound (control)", controlInput, controlStore)
}
