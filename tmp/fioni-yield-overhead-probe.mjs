// Read-only probe: isolate browser-Worker event-loop-yield overhead with interleaved repetitions.
import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs, previewDriveDiscOptimization } from "../backend/driveDiscOptimizer.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const agent = catalog.agentsMap.get("fioni")
const store = JSON.parse(readFileSync(path.join(root, "data/user_drive_discs.json"), "utf8"))
const input = {
  agentId: "fioni",
  coreSkillLevel: "F",
  cinemaLevel: 0,
  wEngineId: "zzz_wiki_154",
  wEngineModificationLevel: 1,
  combatBuffs: { activeBuffIds: ["agent:fioni.corePassive", "agent:fioni.additionalAbility", "agent:fioni.skill.release_crit_dmg"] },
  damage: { mode: "custom", selectedEventId: agent.defaultCalculationConfig.events[0].id, events: JSON.parse(JSON.stringify(agent.defaultCalculationConfig.events)) },
  settings: { fourPieceSetIds: [...agent.preferredDriveDiscSetIds ?? agent.preferredDriveDiscs.defaultSetIds], twoPieceSetIds: [...agent.preferredDriveDiscs.defaultTwoPieceSetIds], disableParallel: true },
}

const reduced = { ...store, driveDiscs: store.driveDiscs.filter(disc => Number(disc.partition) > 3 || disc.source?.sequence % 2 === 0) }
const preview = previewDriveDiscOptimization(catalog, reduced, input)
const estimated = preview.metrics?.estimatedCombinationCount
console.log(JSON.stringify({ estimated, candidates: preview.metrics?.candidateCountsBySlot }))

const setTimeoutRuntime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)) })
const microtaskRuntime = createDriveDiscOptimizerRuntime({ yieldControl: () => Promise.resolve() })

const cases = {
  syncSerial: async () => { optimizeDriveDiscs(catalog, reduced, input) },
  workerDefault_yield50: async () => { await setTimeoutRuntime.optimizeDriveDiscsAsync(catalog, reduced, input, { chunkSize: 5000, progressIntervalMs: 200, yieldIntervalMs: 50, onProgress: () => {} }) },
  worker_yield1000: async () => { await setTimeoutRuntime.optimizeDriveDiscsAsync(catalog, reduced, input, { chunkSize: 5000, progressIntervalMs: 1000, yieldIntervalMs: 1000, onProgress: () => {} }) },
  worker_yield50_microtaskYield: async () => { await microtaskRuntime.optimizeDriveDiscsAsync(catalog, reduced, input, { chunkSize: 5000, progressIntervalMs: 200, yieldIntervalMs: 50, onProgress: () => {} }) },
}

const reps = Number(process.env.PROBE_RUNS ?? 2)
const results = Object.fromEntries(Object.keys(cases).map(key => [key, []]))
for (let rep = 0; rep < reps; rep += 1) {
  for (const key of Object.keys(cases)) {
    const started = Date.now()
    await cases[key]()
    results[key].push(Date.now() - started)
  }
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([key, values]) => [key, { values, min: Math.min(...values), evalsPerSecond: Math.round(estimated / (Math.min(...values) / 1000)) }])), null, 1))
