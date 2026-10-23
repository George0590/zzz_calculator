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
function inputFor(mode){
  const base = fioniOptimizerInput()
  const dc = agent.defaultCalculationConfig
  const input = { ...base,
    damage: { ...base.damage, events: dc.events.map(e=>structuredClone(e)), selectedEventId: dc.events[0].id, skillLevelsByCategory: dc.skillLevelsByCategory },
    combatBuffs: { ...base.combatBuffs, activeBuffIds: ["agent:fioni.corePassive","agent:fioni.additionalAbility","agent:fioni.skill.release_crit_dmg","driveDisc4pc:freedom_blues.self"] },
    settings: { ...base.settings, fourPieceSetIds: preferred.defaultSetIds, twoPieceSetIds: preferred.defaultTwoPieceSetIds, mainStatLimits: preferred.mainStatLimits, algorithm: "exact-super-bound" } }
  if (mode==="noCoreFormula") input.combatBuffs.activeBuffIds = input.combatBuffs.activeBuffIds.filter(id=>id!=="agent:fioni.corePassive")
  return input
}
async function run(label, mode, limitMs){
  const job = runtime.createJob(catalog, realStore, inputFor(mode), {})
  const preview = job.preview()
  const t0 = performance.now()
  let last=null
  const res = await job.run({ onProgress: p=>{last=p.metrics}, ...(limitMs?{shouldCancel:()=>performance.now()-t0>limitMs}:{}) }).catch(e=>{ if(e?.name!=="OptimizerCancelledError") throw e; return null })
  const m = res?.metrics ?? last ?? {}
  console.log(JSON.stringify({label, ms:Math.round(performance.now()-t0), estimated:preview.metrics?.estimatedCombinationCount, evaluated:m.evaluated, pruned:m.prunedBySuperBound, checks:m.superBoundChecks, objCalls:m.objectiveScalarCalls, objFallbacks:m.objectiveScalarFallbacks, kernel:m.scoreKernel}))
}
await run("A_partial_current","current",5000)
await run("B_noCore_after_cancel","noCoreFormula",0)
await run("C_current_full_after","current",0)
