// Read-only probe: real user inventory => default candidate space matrix and
// browser-Worker-equivalent vs Node-serial overhead comparison.
import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs, optimizeDriveDiscsAsync, previewDriveDiscOptimization } from "../backend/driveDiscOptimizer.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const agent = catalog.agentsMap.get("fioni")
const store = JSON.parse(readFileSync(path.join(root, "data/user_drive_discs.json"), "utf8"))

const baseInput = {
  agentId: "fioni",
  coreSkillLevel: "F",
  cinemaLevel: 0,
  wEngineId: "zzz_wiki_154",
  wEngineModificationLevel: 1,
  combatBuffs: { activeBuffIds: ["agent:fioni.corePassive", "agent:fioni.additionalAbility", "agent:fioni.skill.release_crit_dmg"] },
  damage: { mode: "custom", selectedEventId: agent.defaultCalculationConfig.events[0].id, events: JSON.parse(JSON.stringify(agent.defaultCalculationConfig.events)) },
  settings: { fourPieceSetIds: [...agent.preferredDriveDiscs.defaultSetIds], twoPieceSetIds: [...agent.preferredDriveDiscs.defaultTwoPieceSetIds] },
}

function previewOf(label, settingsPatch) {
  const input = { ...baseInput, settings: { ...baseInput.settings, ...settingsPatch } }
  const started = Date.now()
  const preview = previewDriveDiscOptimization(catalog, store, input)
  const metrics = preview.metrics ?? {}
  console.log(JSON.stringify({
    label,
    previewMs: Date.now() - started,
    estimatedCombinationCount: metrics.estimatedCombinationCount,
    candidateCountsBySlot: metrics.candidateCountsBySlot,
    enumerationPlanCount: metrics.enumerationPlanCount,
    appliedPreferredSlots: metrics.appliedPreferredSlots,
    settings: { fourPieceSetIds: preview.settings?.fourPieceSetIds, twoPieceSetIds: preview.settings?.twoPieceSetIds, mainStatLimits: preview.settings?.mainStatLimits },
  }))
}

console.log("## catalog payload size (what a browser Worker receives once)")
console.log(JSON.stringify({ catalogJsonBytes: JSON.stringify(catalog).length }))

console.log("## default amplification matrix on real inventory (preview only)")
previewOf("1 default", {})
previewOf("2 two-piece unrestricted []", { twoPieceSetIds: [] })
previewOf("3 main-stats expanded (all 4/5/6 stats)", {
  mainStatLimits: { 4: ["critRate", "critDmg", "atkPct", "anomalyProficiency", "hpPct", "defPct"], 5: ["fireDmg", "atkPct", "penRatio", "hpPct", "defPct"], 6: ["anomalyMastery", "atkPct", "energyRegen", "impact", "hpPct", "defPct"] },
})
previewOf("4 two 4-piece candidates [freedom_blues, fanged_metal]", { fourPieceSetIds: ["freedom_blues", "fanged_metal"] })
previewOf("5 three 4-piece candidates", { fourPieceSetIds: ["freedom_blues", "fanged_metal", "hormone_punk"] })
previewOf("6 unlimited two-piece + two 4-piece candidates", { twoPieceSetIds: [], fourPieceSetIds: ["freedom_blues", "fanged_metal"] })
previewOf("7 default + minimums atk>=2500/ap>=250", { minimums: { atk: 2500, anomalyProficiency: 250 } })

// ---- browser vs Node timing on a reduced real inventory ----
const reduced = {
  ...store,
  driveDiscs: store.driveDiscs.filter(disc => Number(disc.partition) > 3 || disc.source?.sequence % 2 === 0),
}
const reducedInput = { ...baseInput, settings: { ...baseInput.settings, disableParallel: true } }
const preview = previewDriveDiscOptimization(catalog, reduced, reducedInput)
console.log("## browser-vs-Node timing")
console.log(JSON.stringify({ reducedEstimated: preview.metrics?.estimatedCombinationCount, reducedCandidates: preview.metrics?.candidateCountsBySlot }))

const browserRuntime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)) })
const runs = Number(process.env.PROBE_RUNS ?? 2)
const timings = { nodeSyncSerial: [], browserRuntimeSerial: [], nodeAsync: [] }
for (let run = 0; run < runs; run += 1) {
  let started = Date.now()
  optimizeDriveDiscs(catalog, reduced, reducedInput)
  timings.nodeSyncSerial.push(Date.now() - started)

  started = Date.now()
  let progressCount = 0
  await browserRuntime.optimizeDriveDiscsAsync(catalog, reduced, reducedInput, {
    chunkSize: 5000,
    progressIntervalMs: 200,
    yieldIntervalMs: 50,
    onProgress: () => { progressCount += 1 },
  })
  timings.browserRuntimeSerial.push({ wallMs: Date.now() - started, progressCount })

  started = Date.now()
  const nodeResult = await optimizeDriveDiscsAsync(catalog, reduced, reducedInput)
  timings.nodeAsync.push({ wallMs: Date.now() - started, algorithm: nodeResult.metrics?.algorithmId, fallback: nodeResult.metrics?.parallelFallbackReason ?? null, workerCount: nodeResult.metrics?.workerCount ?? null })
}
console.log(JSON.stringify(timings, null, 1))
