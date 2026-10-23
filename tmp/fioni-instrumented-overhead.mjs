// Read-only probe: instrument yieldControl to attribute worker event-loop overhead.
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
  settings: { fourPieceSetIds: [...agent.preferredDriveDiscs.defaultSetIds], twoPieceSetIds: [...agent.preferredDriveDiscs.defaultTwoPieceSetIds], disableParallel: true },
}
const reduced = { ...store, driveDiscs: store.driveDiscs.filter(disc => Number(disc.partition) > 3 || disc.source?.sequence % 2 === 0) }
const estimated = previewDriveDiscOptimization(catalog, reduced, input).metrics?.estimatedCombinationCount

let yieldCount = 0
let yieldMs = 0
const instrumentedRuntime = createDriveDiscOptimizerRuntime({
  yieldControl: async () => {
    const started = Date.now()
    await new Promise(resolve => setTimeout(resolve, 0))
    yieldMs += Date.now() - started
    yieldCount += 1
  },
})
let progressCount = 0
let started = Date.now()
const result = await instrumentedRuntime.optimizeDriveDiscsAsync(catalog, reduced, input, {
  chunkSize: 5000,
  progressIntervalMs: 200,
  yieldIntervalMs: 50,
  onProgress: () => { progressCount += 1 },
})
const workerWall = Date.now() - started
const m = result.metrics
started = Date.now()
optimizeDriveDiscs(catalog, reduced, input)
const syncWall = Date.now() - started
console.log(JSON.stringify({
  estimated,
  workerWall,
  syncWall,
  workerOverheadPctVsSync: Number((((workerWall - syncWall) / syncWall) * 100).toFixed(1)),
  yieldCount,
  yieldTotalMs: yieldMs,
  yieldPctOfWorkerWall: Number(((yieldMs / workerWall) * 100).toFixed(1)),
  progressCount,
  internal: {
    warmupMs: m.warmupMs,
    planBuildMs: m.planBuildMs,
    scoreOnlyMs: m.scoreOnlyMs,
    fullResultMs: m.fullResultMs,
    denseScoreMs: m.denseScoreMs,
    scoreKernelProbeMs: m.scoreKernelProbeMs,
    denseScoreCalls: m.denseScoreCalls,
    evaluated: m.evaluated,
    prunedBySuperBound: m.prunedBySuperBound,
  },
}, null, 1))
