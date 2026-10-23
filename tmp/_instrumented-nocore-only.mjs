import fs from "node:fs"
import path from "node:path"
import { loadCalculatorContext } from "../backend/calculator.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"
const root = path.resolve(".")
const catalog = await loadCalculatorContext(root)
const realStore = JSON.parse(fs.readFileSync("data/user_drive_discs.json","utf8"))
const agent = catalog.agentsMap.get("fioni")
const preferred = agent.preferredDriveDiscs
const runtime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(r=>setImmediate(r)) })
const base = fioniOptimizerInput()
const dc = agent.defaultCalculationConfig
const input = { ...base,
  damage: { ...base.damage, events: dc.events.map(e=>structuredClone(e)), selectedEventId: dc.events[0].id, skillLevelsByCategory: dc.skillLevelsByCategory },
  combatBuffs: { ...base.combatBuffs, activeBuffIds: ["agent:fioni.additionalAbility","agent:fioni.skill.release_crit_dmg","driveDisc4pc:freedom_blues.self"] },
  settings: { ...base.settings, fourPieceSetIds: preferred.defaultSetIds, twoPieceSetIds: preferred.defaultTwoPieceSetIds, mainStatLimits: preferred.mainStatLimits, algorithm: "exact-super-bound" } }
globalThis.__FIONI_OPT_DBG = undefined
const job = runtime.createJob(catalog, realStore, input, {})
const preview = job.preview()
const t0 = performance.now()
const res = await job.run({})
const m = res.metrics
const dbg = globalThis.__FIONI_OPT_DBG ?? {}
console.log(JSON.stringify({ms:Math.round(performance.now()-t0), estimated:preview.metrics?.estimatedCombinationCount, evaluated:m.evaluated, pruned:m.prunedBySuperBound, checks:m.superBoundChecks, objCalls:m.objectiveScalarCalls, objFallbacks:m.objectiveScalarFallbacks, meta:dbg.meta, boundInfinity:dbg.boundInfinityReleaseInterval, pruneCalls:dbg.pruneCalls, kernel0:(dbg.kernelInfo??[])[0]},null,1))
