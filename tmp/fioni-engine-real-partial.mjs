// Instrumented evidence at real-inventory scale: counts pruning attempts and how many
// were rejected by the release-interval early return. Repository sources are not modified;
// core/driveDiscOptimizer-core.js is patched in memory by the loader.
// Run: node --import ./tmp/fioni-engine-instrument-register.mjs tmp/fioni-engine-real-partial.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadCalculatorContext } from "../backend/calculator.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(rootDir)
const realStore = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "user_drive_discs.json"), "utf8"))
const agent = catalog.agentsMap?.get("fioni")
const preferred = agent?.preferredDriveDiscs ?? {}
const runtime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(resolve => setImmediate(resolve)) })

function inputFor(mode) {
    const base = fioniOptimizerInput()
    const defaultConfig = agent?.defaultCalculationConfig ?? {}
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
            fourPieceSetIds: preferred.defaultSetIds ?? [],
            twoPieceSetIds: preferred.defaultTwoPieceSetIds ?? [],
            mainStatLimits: preferred.mainStatLimits ?? base.settings.mainStatLimits,
            algorithm: "exact-super-bound",
        },
    }
    if (mode === "noCoreFormula") {
        input.combatBuffs.activeBuffIds = input.combatBuffs.activeBuffIds
            .filter(id => id !== "agent:fioni.corePassive")
    }
    return input
}

async function run(label, { mode = "current", limitMs = 0 } = {}) {
    globalThis.__FIONI_OPT_DBG = undefined
    const job = runtime.createJob(catalog, realStore, inputFor(mode), {})
    const preview = job.preview()
    const started = performance.now()
    let lastMetrics = null
    const result = await job.run({
        onProgress: progress => { lastMetrics = progress.metrics },
        ...(limitMs ? { shouldCancel: () => performance.now() - started > limitMs } : {}),
    }).catch(error => {
        if (error?.name !== "OptimizerCancelledError") throw error
        return null
    })
    const elapsedMs = performance.now() - started
    const dbg = globalThis.__FIONI_OPT_DBG ?? {}
    const metrics = result?.metrics ?? lastMetrics ?? {}
    console.log(JSON.stringify({
        label,
        elapsedMs: Math.round(elapsedMs),
        cancelled: !result,
        estimated: Number(preview.metrics?.estimatedCombinationCount ?? 0),
        candidateCountsBySlot: preview.metrics?.candidateCountsBySlot,
        evaluated: metrics.evaluated,
        prunedBySuperBound: metrics.prunedBySuperBound,
        superBoundChecks: metrics.superBoundChecks,
        pruneCalls: dbg.pruneCalls,
        pruneCallsWithFiniteCutoff: dbg.pruneCallsWithFiniteCutoff,
        boundInfinityReleaseInterval: dbg.boundInfinityReleaseInterval,
        boundInfinityFreeTwoPiece: dbg.boundInfinityFreeTwoPiece,
        requiresReleaseIntervalBound: dbg.meta?.requiresReleaseIntervalBound ?? null,
        kernelSample: (dbg.kernelInfo ?? [])[0] ?? null,
        top1: result?.results?.[0]?.score ?? null,
    }, null, 1))
}

await run("real_current_partial_6s", { limitMs: 6000 })
await run("real_noCoreFormula_full", { mode: "noCoreFormula" })
