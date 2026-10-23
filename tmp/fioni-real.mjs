import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const store = JSON.parse(readFileSync(path.join(root, "data/user_drive_discs.json"), "utf8"))
const ownerId = store.currentOwnerId ?? "default"
const owned = store.driveDiscs.filter(d => (d.ownerId ?? ownerId) === ownerId)
console.log("inventory", { total: store.driveDiscs.length, ownerId, owned: owned.length })
const counts = {}
for (const d of owned) counts[d.setId] = (counts[d.setId] ?? 0) + 1
console.log("inventory sets", counts)

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
        algorithm: process.env.ALGO ?? "exact-super-bound",
    },
}
console.log("optimizer input settings", JSON.stringify(input.settings))
const mode = process.env.MODE ?? "current"
const activeBuffIds = ["agent:fioni.corePassive", "agent:fioni.additionalAbility", "agent:fioni.skill.release_crit_dmg", "driveDisc4pc:freedom_blues.self"]
if (mode === "noCoreFormula") input.combatBuffs.activeBuffIds = activeBuffIds.filter(id => id !== "agent:fioni.corePassive")
if (mode === "attribute") {
    input.damage.events = [{ ...input.damage.events[0], settlementType: "attribute", triggerActorRef: undefined }]
}
if (mode === "direct") {
    input.damage.events = [{ id: "direct", kind: "direct", skillMultiplier: 4.45, count: 1, stunned: true, critMode: "expected" }]
}

const runtime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(resolve => setImmediate(resolve)) })
const job = runtime.createJob(catalog, store, input, {})
const preview = job.preview()
console.log("PREVIEW", JSON.stringify({
    candidateCountsBySlot: preview.metrics?.candidateCountsBySlot,
    estimatedCombinationCount: preview.metrics?.estimatedCombinationCount,
}, null, 1))

const limitMs = Number(process.env.RUN_LIMIT_MS ?? 20000)
const startedAt = performance.now()
let lastPercent = -1
let lastMetrics = null
const result = await job.run({
    shouldCancel: () => performance.now() - startedAt > limitMs,
    onProgress: progress => {
        lastMetrics = progress.metrics
        const percent = Math.floor(Number(progress.percent ?? 0))
        if (percent !== lastPercent) {
            lastPercent = percent
            console.log("PROGRESS", JSON.stringify({
                ms: Math.round(performance.now() - startedAt),
                percent: Number(progress.percent ?? 0).toFixed(2),
                evaluated: progress.evaluated,
                estimated: progress.estimatedCombinationCount,
                evalPerSec: Math.round(Number(progress.metrics?.evaluationsPerSecond ?? 0)),
            }))
        }
    },
}).catch(error => {
    if (error?.name === "OptimizerCancelledError" || error?.constructor?.name === "OptimizerCancelledError") {
        console.log("CANCELLED after", Math.round(performance.now() - startedAt), "ms (only", lastPercent, "% done)")
        const keys = ["evaluated", "scoredCombinationCount", "denseScoreCalls", "denseScoreMs", "scoreOnlyMs", "fullResultMs",
            "boundCheckMs", "superBoundChecks", "safeBoundFallbacks", "specializedScoreCalls", "objectiveScalarCalls"]
        console.log("CANCEL METRICS", JSON.stringify(Object.fromEntries(keys.map(key => [key, lastMetrics?.[key]])), null, 1))
        return null
    }
    throw error
})
if (result) console.log("DONE", result.results?.length, "results")
