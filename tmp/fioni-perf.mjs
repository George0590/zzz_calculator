// Reproducible performance benchmark for the fioni drive-disc optimizer.
//
// Usage (from repository root):
//   node tmp/fioni-perf.mjs                      # default: fast matrix (synthetic stores)
//   PERF_CASES=matrix node tmp/fioni-perf.mjs
//   PERF_CASES=real-full node tmp/fioni-perf.mjs         # one full real-inventory run (~2-3 min on the slow path)
//   PERF_CASES=real-partial node tmp/fioni-perf.mjs      # 3 x 6s cancelled samples of the real inventory
//   PERF_CASES=real-variants node tmp/fioni-perf.mjs     # real inventory with release-corePassive removed / attribute / direct events
//   PERF_CASES=real-parallel node tmp/fioni-perf.mjs     # real inventory with exact-super-bound-parallel
//   PERF_CASES=all node tmp/fioni-perf.mjs
//
// Writes raw numbers to tmp/fioni-perf-raw.json (merged by case id, safe to run repeatedly).
// Never modifies repository sources or data/; uses the real inventory read-only.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cpus } from "node:os"

import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs, optimizeDriveDiscsAsync } from "../backend/driveDiscOptimizer.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"
import { fioniOptimizerInput, fioniOptimizerStore } from "../tests/fixtures/fioni-optimizer.js"
import { velinaOptimizerInput, velinaOptimizerStore } from "../tests/fixtures/velina-optimizer.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rawPath = path.join(rootDir, "tmp", "fioni-perf-raw.json")
const catalog = await loadCalculatorContext(rootDir)

const requestedCases = new Set(
    String(process.env.PERF_CASES ?? "matrix").split(",").map(item => item.trim()).filter(Boolean),
)
const wants = name => requestedCases.has("all") || requestedCases.has(name)

// ---------------------------------------------------------------- utilities

// Deterministic single-core workload used to detect CPU contention from other
// teammates' benchmarks. Reported next to every case; no timing is "adjusted",
// the calibration only documents the environment.
function calibration() {
    const started = performance.now()
    let acc = 0
    for (let index = 0; index < 3_000_000; index += 1) {
        acc += Math.sqrt((index % 1024) + 1) * 1.0000001
    }
    return { calibrationMs: Number((performance.now() - started).toFixed(2)), sink: acc }
}

function median(sortedValues) {
    return sortedValues[Math.floor(sortedValues.length / 2)]
}

const METRIC_KEYS = [
    "estimatedCombinationCount", "enumerationPlanCount", "evaluated", "scoredCombinationCount", "processedCombinationCount",
    "prunedBySuperBound", "prunedByChunkBound", "prunedBySuffixTopKBound", "prunedByGlobalCutoff", "prunedByUpperBound",
    "prunedBySetFeasibility", "superBoundChecks", "groupBoundChecks", "chunkBoundChecks", "discBoundChecks",
    "suffixTopKBoundChecks", "boundOracleChecks", "safeBoundFallbacks", "dominanceMode", "relevantStatCount",
    "scoreKernel", "scoreKernelFallbackReason", "denseScoreCalls", "denseScoreMs", "specializedScoreCalls",
    "specializedScoreFallbacks", "specializedScoreFallbackReason", "objectiveScalarCalls", "objectiveScalarFallbacks",
    "objectiveScalarFallbackReason", "scoreOnlyMs", "boundCheckMs", "fullResultMs", "warmupMs", "planBuildMs",
    "scoreKernelProbeMs", "seededTopKCount", "seedBudgetUsed", "seedPlanCount", "seedBeamWidth",
    "evaluationsPerSecond", "scoredCombinationsPerSecond", "strictExact", "algorithmId",
    "preparationMs", "elapsedMs", "workerCount", "parallelTaskCount", "globalCutoffUpdate",
]

function metricSnapshot(metrics = {}) {
    const snapshot = {}
    for (const key of METRIC_KEYS) {
        if (key in metrics) snapshot[key] = metrics[key]
    }
    return snapshot
}

function topResults(results = []) {
    return results.map(item => ({
        rank: item.rank,
        ids: (item.driveDiscs ?? []).map(disc => disc.id).join("|"),
        score: Number(Number(item.score).toFixed(6)),
    }))
}

function runSyncRepeat(label, makeArgs, repeats = 3) {
    const runs = []
    for (let index = 0; index < repeats; index += 1) {
        const args = makeArgs()
        const started = performance.now()
        const result = optimizeDriveDiscs(catalog, args.store, args.input)
        const elapsedMs = performance.now() - started
        runs.push({ elapsedMs, result })
    }
    const sorted = [...runs].sort((left, right) => left.elapsedMs - right.elapsedMs)
    const medianRun = sorted[Math.floor(sorted.length / 2)]
    return {
        label,
        elapsedMsMedian: Number(medianRun.elapsedMs.toFixed(1)),
        elapsedMsAll: runs.map(run => Number(run.elapsedMs.toFixed(1))),
        calibration: calibration(),
        metrics: metricSnapshot(medianRun.result.metrics),
        topResults: topResults(medianRun.result.results),
    }
}

async function runAsyncRepeat(label, makeArgs, repeats = 2) {
    const runs = []
    for (let index = 0; index < repeats; index += 1) {
        const args = makeArgs()
        const started = performance.now()
        const result = await optimizeDriveDiscsAsync(catalog, args.store, args.input)
        const elapsedMs = performance.now() - started
        runs.push({ elapsedMs, result })
    }
    const sorted = [...runs].sort((left, right) => left.elapsedMs - right.elapsedMs)
    const medianRun = sorted[Math.floor(sorted.length / 2)]
    return {
        label,
        elapsedMsMedian: Number(medianRun.elapsedMs.toFixed(1)),
        elapsedMsAll: runs.map(run => Number(run.elapsedMs.toFixed(1))),
        calibration: calibration(),
        metrics: metricSnapshot(medianRun.result.metrics),
        topResults: topResults(medianRun.result.results),
    }
}

// ------------------------------------------------------- synthetic inventory

const FIONI_FOUR_SET = "phaethons_melody"
const FIONI_TWO_SET = "hormone_punk"
const FIONI_SLOT_MAIN = {
    1: { stat: "hpFlat", value: 2200 },
    2: { stat: "atkFlat", value: 316 },
    3: { stat: "defFlat", value: 184 },
    4: { stat: "anomalyProficiency", value: 92 },
    5: { stat: "fireDmg", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
const FIONI_SUBSTAT_POOL = ["atkPct", "anomalyProficiency", "penFlat", "atkFlat", "critRate", "critDmg"]

function fioniDisc(id, setId, partition, variant) {
    return {
        id, ownerId: "default", setId,
        setName: catalog.driveDiscSetsMap.get(setId)?.name?.zhCN ?? setId,
        partition, rarity: "S", level: 15, maxLevel: 15, locked: false, equippedBy: null,
        mainStat: { ...FIONI_SLOT_MAIN[partition], label: FIONI_SLOT_MAIN[partition].stat },
        subStats: Array.from({ length: 4 }, (_, index) => {
            const stat = FIONI_SUBSTAT_POOL[(variant + index + partition) % FIONI_SUBSTAT_POOL.length]
            const value = stat === "atkPct" ? 3 + ((variant + partition) % 5) * 1.5
                : stat === "anomalyProficiency" ? 9 + ((variant + partition) % 5) * 9
                    : stat === "penFlat" ? 6 + ((variant + partition) % 5) * 3
                        : stat === "atkFlat" ? 19 + ((variant + partition) % 5) * 19
                            : stat === "critRate" ? 2.4 + ((variant + partition) % 4) * 1.2
                                : 4.8 + ((variant + partition) % 5) * 2.4
            return { stat, value, label: stat }
        }),
        source: { type: "perf-fixture", sequence: Number(id.replace(/\D/g, "")) || 999 },
    }
}

// Both sets exist in every slot: c candidates per set per slot -> total 2c per slot.
// Fixed 4-piece + fixed 2-piece gives 15 masks * c^4 * c^2 = 15 * c^6 combinations.
function fioniStore(c) {
    const driveDiscs = []
    for (const slot of [1, 2, 3, 4, 5, 6]) {
        for (let variant = 0; variant < c; variant += 1) {
            driveDiscs.push(fioniDisc(`f${slot}-${variant}`, FIONI_FOUR_SET, slot, variant))
            driveDiscs.push(fioniDisc(`h${slot}-${variant}`, FIONI_TWO_SET, slot, variant + c))
        }
    }
    return { version: 1, owners: [{ id: "default", label: "默认用户" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

function fioniInput(algorithm = "exact-super-bound") {
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

// ye_shunguang direct-damage control: same 2-sets-in-every-slot structure as the
// project benchmark's "small" scale (benchmarks/optimizer-benchmark.js), 15 * c^6 combos.
const YE_FOUR_SET = "woodpecker_electro"
const YE_TWO_SET = "hormone_punk"
const YE_SLOT_MAIN = {
    1: { stat: "hpFlat", value: 2200 },
    2: { stat: "atkFlat", value: 316 },
    3: { stat: "defFlat", value: 184 },
    4: { stat: "critRate", value: 24, mode: "pct" },
    5: { stat: "physicalDmg", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
const YE_SUBSTAT_POOL = ["critRate", "critDmg", "atkPct", "penRatio", "anomalyProficiency", "atkFlat"]

function yeDisc(id, setId, partition, variant) {
    return {
        id, ownerId: "default", setId,
        setName: catalog.driveDiscSetsMap.get(setId)?.name?.zhCN ?? setId,
        partition, rarity: "S", level: 15, maxLevel: 15, locked: false, equippedBy: null,
        mainStat: { ...YE_SLOT_MAIN[partition], label: YE_SLOT_MAIN[partition].stat },
        subStats: Array.from({ length: 4 }, (_, index) => {
            const stat = YE_SUBSTAT_POOL[(variant + index + partition) % YE_SUBSTAT_POOL.length]
            const value = stat === "critRate" ? 2.4 + ((variant + partition) % 4) * 1.2
                : stat === "critDmg" ? 4.8 + ((variant + partition) % 5) * 2.4
                    : stat === "atkFlat" ? 19 + ((variant + partition) % 5) * 19
                        : 3 + ((variant + partition + index) % 5) * 1.5
            return { stat, value, label: stat }
        }),
        source: { type: "perf-fixture", sequence: Number(id.replace(/\D/g, "")) || 999 },
    }
}

function yeStore(c) {
    const driveDiscs = []
    for (const slot of [1, 2, 3, 4, 5, 6]) {
        for (let variant = 0; variant < c; variant += 1) {
            driveDiscs.push(yeDisc(`y${slot}-${variant}`, YE_FOUR_SET, slot, variant))
            driveDiscs.push(yeDisc(`p${slot}-${variant}`, YE_TWO_SET, slot, variant + c))
        }
    }
    return { version: 1, owners: [{ id: "default", label: "默认用户" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

function yeInput(algorithm = "exact-super-bound") {
    const example = catalog.examples.yeShunguang.input
    return {
        agentId: example.agentId,
        coreSkillLevel: example.coreSkillLevel,
        wEngineId: example.wEngineId,
        combatBuffs: { activeBuffIds: [] },
        damage: example.damage,
        settings: {
            fourPieceSetId: YE_FOUR_SET,
            twoPieceSetId: YE_TWO_SET,
            objective: "damage",
            algorithm,
        },
    }
}

// ------------------------------------------------------------ real inventory

const realStore = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "user_drive_discs.json"), "utf8"))
const fioniAgent = catalog.agentsMap?.get("fioni")
const fioniPreferred = fioniAgent?.preferredDriveDiscs ?? {}

function realFioniInput({ mode = "current", algorithm = "exact-super-bound", workerCount = null, setOverride = null } = {}) {
    const base = fioniOptimizerInput()
    const defaultConfig = fioniAgent?.defaultCalculationConfig ?? {}
    const input = {
        ...base,
        damage: {
            ...base.damage,
            events: (defaultConfig.events ?? base.damage.events).map(event => structuredClone(event)),
            selectedEventId: defaultConfig.events?.[0]?.id ?? base.damage.selectedEventId,
            skillLevelsByCategory: defaultConfig.skillLevelsByCategory ?? base.damage.skillLevelsByCategory,
        },
        combatBuffs: {
            ...base.combatBuffs,
            activeBuffIds: [
                "agent:fioni.corePassive",
                "agent:fioni.additionalAbility",
                "agent:fioni.skill.release_crit_dmg",
                "driveDisc4pc:freedom_blues.self",
            ],
        },
        settings: {
            ...base.settings,
            fourPieceSetIds: fioniPreferred.defaultSetIds ?? [],
            twoPieceSetIds: fioniPreferred.defaultTwoPieceSetIds ?? [],
            mainStatLimits: fioniPreferred.mainStatLimits ?? base.settings.mainStatLimits,
            algorithm,
            ...(workerCount ? { workerCount } : {}),
            ...(setOverride ?? {}),
        },
    }
    if (mode === "noCoreFormula") {
        input.combatBuffs.activeBuffIds = input.combatBuffs.activeBuffIds
            .filter(id => id !== "agent:fioni.corePassive")
    } else if (mode === "attribute") {
        input.damage.events = [{ ...input.damage.events[0], settlementType: "attribute", triggerActorRef: undefined }]
    } else if (mode === "direct") {
        input.damage.events = [{ id: "direct", kind: "direct", skillMultiplier: 4.45, count: 1, stunned: true, critMode: "expected" }]
    }
    return input
}

const realRuntime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(resolve => setImmediate(resolve)) })
const REAL_SAMPLE_MS = Math.max(1000, Number(process.env.PERF_REAL_SAMPLE_MS ?? 6000))

async function realCase({ label, mode = "current", algorithm = "exact-super-bound", repeats = 1, sampleMs = 0, workerCount = null, setOverride = null }) {
    const runs = []
    let previewMetrics = null
    for (let index = 0; index < repeats; index += 1) {
        const prepStarted = performance.now()
        const job = realRuntime.createJob(catalog, realStore, realFioniInput({ mode, algorithm, workerCount, setOverride }), {})
        const preview = job.preview()
        if (!previewMetrics) previewMetrics = metricSnapshot(preview.metrics)
        const runStarted = performance.now()
        let lastMetrics = null
        let lastPercent = 0
        let lastEmittedPercent = -1
        const progressSamples = []
        const onProgress = progress => {
            lastMetrics = progress.metrics
            lastPercent = Number(progress.percent ?? 0)
            const percent = Math.floor(lastPercent)
            const wallMs = performance.now() - runStarted
            if (sampleMs && wallMs > sampleMs && percent > lastEmittedPercent) {
                lastEmittedPercent = percent
                progressSamples.push({ wallMs: Math.round(wallMs), percent: Number(lastPercent.toFixed(2)), evaluated: progress.evaluated })
            }
        }
        let result = null
        let cancelled = false
        try {
            result = await job.run({
                onProgress,
                ...(sampleMs ? { shouldCancel: () => performance.now() - runStarted > sampleMs } : {}),
            })
        } catch (error) {
            if (error?.name === "OptimizerCancelledError") {
                cancelled = true
            } else {
                throw error
            }
        }
        const elapsedMs = performance.now() - runStarted
        runs.push({
            elapsedMs,
            prepMs: runStarted - prepStarted,
            cancelled,
            result,
            lastMetrics,
            lastPercent,
            progressSamples,
        })
    }
    const sorted = [...runs].sort((left, right) => left.elapsedMs - right.elapsedMs)
    const medianRun = sorted[Math.floor(sorted.length / 2)]
    return {
        label,
        mode,
        algorithm,
        cancelled: medianRun.cancelled,
        elapsedMsMedian: Number(medianRun.elapsedMs.toFixed(1)),
        elapsedMsAll: runs.map(run => Number(run.elapsedMs.toFixed(1))),
        prepMsMedian: Number(medianRun.prepMs.toFixed(1)),
        percentDone: Number(medianRun.lastPercent.toFixed(2)),
        previewMetrics,
        metrics: metricSnapshot(medianRun.result?.metrics ?? medianRun.lastMetrics ?? {}),
        progressSamples: medianRun.progressSamples,
        topResults: topResults(medianRun.result?.results ?? []),
        calibration: calibration(),
    }
}

// ------------------------------------------------------------------ runner

const out = { meta: { node: process.version, cpus: cpus().length, startedAt: new Date().toISOString(), cases: [...requestedCases] }, cases: [] }
function record(entry) {
    entry.calibration = entry.calibration ?? calibration()
    out.cases.push(entry)
    const printable = { label: entry.label, elapsedMsMedian: entry.elapsedMsMedian, elapsedMsAll: entry.elapsedMsAll }
    if (entry.metrics) {
        const m = entry.metrics
        Object.assign(printable, {
            estimated: m.estimatedCombinationCount, evaluated: m.evaluated, scored: m.scoredCombinationCount,
            pruned: m.prunedBySuperBound, superChecks: m.superBoundChecks, safeFallbacks: m.safeBoundFallbacks,
            kernel: m.scoreKernel, eps: Math.round(Number(m.evaluationsPerSecond ?? 0)),
            scoreOnlyMs: Number(Number(m.scoreOnlyMs ?? 0).toFixed(1)), denseScoreMs: Number(Number(m.denseScoreMs ?? 0).toFixed(1)),
            boundCheckMs: Number(Number(m.boundCheckMs ?? 0).toFixed(1)), fullResultMs: Number(Number(m.fullResultMs ?? 0).toFixed(1)),
        })
    }
    console.log("CASE", JSON.stringify(printable))
    return entry
}

if (wants("matrix")) {
    for (const c of [2]) {
        record(runSyncRepeat(`fioni_sb_c${c}`, () => ({ store: fioniStore(c), input: fioniInput("exact-super-bound") }), 3))
    }
    record(runSyncRepeat("fioni_sb_c3", () => ({ store: fioniStore(3), input: fioniInput("exact-super-bound") }), 2))
    record(runSyncRepeat("fioni_legacy_c2", () => ({ store: fioniStore(2), input: fioniInput("exact-legacy") }), 2))
    record(runSyncRepeat("fioni_legacy_c3", () => ({ store: fioniStore(3), input: fioniInput("exact-legacy") }), 1))
    record(await runAsyncRepeat("fioni_parallel_c3", () => ({ store: fioniStore(3), input: fioniInput("exact-super-bound-parallel") }), 1))
    for (const c of [2, 3, 4, 5]) {
        record(runSyncRepeat(`velina_sb_c${c}`, () => ({
            store: velinaOptimizerStore({ variants: c }),
            input: { ...velinaOptimizerInput(), settings: { ...velinaOptimizerInput().settings, algorithm: "exact-super-bound" } },
        }), 3))
    }
    for (const c of [2, 3, 4, 5]) {
        record(runSyncRepeat(`ye_shunguang_sb_c${c}`, () => ({ store: yeStore(c), input: yeInput("exact-super-bound") }), 3))
    }
    // Official fioni test fixture (fixed 4pc in slots 1-4, 2pc in 5-6, 2 variants -> 64 combos)
    record(runSyncRepeat("fioni_fixture_64", () => ({
        store: fioniOptimizerStore(),
        input: { ...fioniOptimizerInput(), settings: { ...fioniOptimizerInput().settings, algorithm: "exact-super-bound" } },
    }), 3))
}

if (wants("real-partial")) {
    record(await realCase({ label: "real_partial_6s", repeats: 3, sampleMs: REAL_SAMPLE_MS }))
}

if (wants("real-full")) {
    record(await realCase({ label: "real_current_full", repeats: 1 }))
}

if (wants("real-variants")) {
    record(await realCase({ label: "real_noCoreFormula_full", mode: "noCoreFormula", repeats: 1 }))
    record(await realCase({ label: "real_attribute_full", mode: "attribute", repeats: 1 }))
    record(await realCase({ label: "real_direct_full", mode: "direct", repeats: 1 }))
}

if (wants("real-alt-sets")) {
    record(await realCase({
        label: "real_alt_sets_full",
        repeats: 1,
        setOverride: { fourPieceSetIds: ["phaethons_melody"], twoPieceSetIds: ["hormone_punk"] },
    }))
}

if (wants("real-parallel")) {
    record(await realCase({ label: "real_parallel_default_workers", algorithm: "exact-super-bound-parallel", repeats: 1 }))
}

out.meta.finishedAt = new Date().toISOString()
let previous = { cases: [] }
try {
    previous = JSON.parse(fs.readFileSync(rawPath, "utf8"))
} catch {
    // first run
}
const merged = new Map((previous.cases ?? []).map(item => [item.label, item]))
for (const entry of out.cases) merged.set(entry.label, entry)
fs.writeFileSync(rawPath, `${JSON.stringify({ meta: out.meta, cases: [...merged.values()] }, null, 1)}\n`, "utf8")
console.log("RAW", rawPath)
