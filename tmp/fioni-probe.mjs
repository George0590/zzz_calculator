import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"

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

function store(variants) {
    const driveDiscs = []
    for (const slot of [1, 2, 3, 4, 5, 6]) {
        for (let v = 0; v < variants; v += 1) {
            driveDiscs.push(disc(`f${slot}-${v}`, fourSet, slot, v))
            driveDiscs.push(disc(`h${slot}-${v}`, twoSet, slot, v + variants))
        }
    }
    return { version: 1, owners: [{ id: "default", label: "默认用户" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

function input(algorithm) {
    const base = fioniOptimizerInput()
    return {
        ...base,
        settings: {
            ...base.settings,
            algorithm,
            ...(algorithm === "exact-legacy" ? { enableUpperBoundPruning: false } : {}),
        },
    }
}

const scale = Number(process.env.PROBE_VARIANTS ?? 3)
for (const algorithm of ["exact-super-bound", "exact-legacy"]) {
    const started = performance.now()
    const result = optimizeDriveDiscs(catalog, store(scale), input(algorithm))
    const elapsed = performance.now() - started
    const m = result.metrics ?? {}
    console.log(JSON.stringify({
        algorithm, elapsedMs: Math.round(elapsed), strictExact: m.strictExact,
        candidateCountsBySlot: m.candidateCountsBySlot,
        estimatedCombinationCount: m.estimatedCombinationCount,
        evaluated: m.evaluated, scored: m.scoredCombinationCount,
        prunedBySuperBound: m.prunedBySuperBound, prunedByChunkBound: m.prunedByChunkBound,
        prunedBySuffixTopK: m.prunedBySuffixTopKBound, prunedByGlobalCutoff: m.prunedByGlobalCutoff,
        safeBoundFallbacks: m.safeBoundFallbacks, superBoundChecks: m.superBoundChecks,
        scoreKernel: m.scoreKernel, scoreKernelFallbackReason: m.scoreKernelFallbackReason,
        specializedScoreCalls: m.specializedScoreCalls, specializedScoreFallbacks: m.specializedScoreFallbacks,
        specializedScoreFallbackReason: m.specializedScoreFallbackReason,
        objectiveScalarCalls: m.objectiveScalarCalls, objectiveScalarFallbacks: m.objectiveScalarFallbacks,
        relevantStatCount: m.relevantStatCount,
        boundingStats: m.boundingStatIds,
        denseScoreMs: m.denseScoreMs, boundCheckMs: m.boundCheckMs, fullResultMs: m.fullResultMs,
        evaluationsPerSecond: m.evaluationsPerSecond,
        top1: result.results?.[0]?.score,
    }, null, 1))
}
