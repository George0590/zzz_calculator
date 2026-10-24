import path from "node:path"
import { loadCalculatorContext, createInCombatPanelCalculator } from "../backend/calculator.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"
const catalog = await loadCalculatorContext(path.resolve("."))
function panelFor(input, activeBuffIds, damage) {
  return createInCombatPanelCalculator(catalog, {
    agentId: input.agentId, coreSkillLevel: input.coreSkillLevel, cinemaLevel: input.cinemaLevel,
    wEngineId: input.wEngineId, wEngineModificationLevel: input.wEngineModificationLevel,
    combatBuffs: { ...input.combatBuffs, activeBuffIds }, damage,
  })
}
function makeStatIds(catalog){ return ["atk","anomalyMastery","anomalyProficiency","critRate","critDmg","penRatio","dmgBonus","fireDmg","atkPct","hpFlat","atkFlat","defFlat"] }
const base = fioniOptimizerInput()
const activeAll = [...base.combatBuffs.activeBuffIds]
const setIds = ["hormone_punk","phaethons_melody"]
const setIndexById = new Map(setIds.map((id,i)=>[id,i]))
const statIds = makeStatIds(catalog)
for (const [label, ids] of [["with-corePassive", activeAll], ["without-corePassive", activeAll.filter(x=>x!=="agent:fioni.corePassive")]]) {
  const pc = panelFor(base, ids, base.damage)
  const meta = pc.optimizerStatMetadata({minimums:{}})
  const target = pc.compileDensePanelScoreTarget({ statIds, setIds, setIndexById, candidateStatIndexes: [] })
  const kernel = target?.compileForSetCounts?.([2,4])
  console.log(label, JSON.stringify({meta:{strictMonotonic:meta.strictMonotonic,requiresReleaseIntervalBound:meta.requiresReleaseIntervalBound,panelStatIds:meta.panelStatIds,relevantStatIds:meta.relevantStatIds}, target: target? "ok":"null", kernel: kernel && {scoreKernel:kernel.scoreKernel, releaseIntervalBound:kernel.releaseIntervalBound, hasScalar:typeof kernel.scoreScalar==="function", hasObjScalar:typeof kernel.scoreObjectiveScalar==="function", hasCombined:typeof kernel.scoreCombinedScalar==="function"}}))
}
// attribute-anomaly variant (no release)
const attrDamage = { mode:"custom", agentLevel:60, skillLevelsByCategory:{basic:12,chain:12}, selectedEventId:"attr", events:[{ id:"attr", kind:"anomaly", settlementType:"attribute", anomalyEffect:"burn", count:1, stunned:true, critMode:"expected" }] }
for (const [label, ids] of [["attr-with-corePassive", activeAll]]) {
  const pc = panelFor(base, ids, attrDamage)
  const meta = pc.optimizerStatMetadata({minimums:{}})
  const target = pc.compileDensePanelScoreTarget({ statIds, setIds, setIndexById, candidateStatIndexes: [] })
  const kernel = target?.compileForSetCounts?.([2,4])
  console.log(label, JSON.stringify({meta:{strictMonotonic:meta.strictMonotonic,requiresReleaseIntervalBound:meta.requiresReleaseIntervalBound}, kernel: kernel && {scoreKernel:kernel.scoreKernel, releaseIntervalBound:kernel.releaseIntervalBound, hasObjScalar:typeof kernel.scoreObjectiveScalar==="function"}}))
}
