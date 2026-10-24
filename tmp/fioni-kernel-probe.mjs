// Read-only probe: inspect Fioni fixed-set scoring kernel / releaseIntervalBound capability.
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext, createInCombatPanelCalculator } from "../backend/calculator.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const agent = catalog.agentsMap.get("fioni")
const events = JSON.parse(JSON.stringify(agent.defaultCalculationConfig.events))

function makeInput(eventList, activeBuffIds) {
  return {
    agentId: "fioni",
    coreSkillLevel: "F",
    cinemaLevel: 0,
    wEngineId: "zzz_wiki_154",
    wEngineModificationLevel: 1,
    combatBuffs: { activeBuffIds },
    damage: { mode: "custom", selectedEventId: eventList[0].id, events: eventList },
    settings: { fourPieceSetIds: [agent.preferredDriveDiscs.defaultSetIds[0]] },
  }
}

const buffIds = ["agent:fioni.corePassive", "agent:fioni.additionalAbility", "agent:fioni.skill.release_crit_dmg"]
const attributeEvents = events.map(event => {
  const copy = { ...event, settlementType: "attribute" }
  delete copy.triggerActorRef
  delete copy.releaseSkillRef
  return copy
})

for (const [label, eventList, buffs] of [
  ["release default event", events, buffIds],
  ["release event, corePassive OFF", events, buffIds.filter(id => id !== "agent:fioni.corePassive")],
  ["attribute downgraded event", attributeEvents, buffIds],
]) {
  const input = makeInput(eventList, buffs)
  const calculator = createInCombatPanelCalculator(catalog, input)
  const meta = calculator.optimizerStatMetadata()
  const dense = calculator.compileDensePanelScoreTarget({ statIds: ["atkPct", "anomalyProficiency", "anomalyMastery", "fireDmg", "penRatio"] })
  const kernel = dense?.compileForSetCounts?.([4, 0, 2].slice(0, 1))
  console.log(JSON.stringify({
    label,
    metadata: meta,
    denseKernel: Boolean(dense),
    fixedKernelKeys: kernel ? Object.keys(kernel) : null,
    releaseIntervalBound: kernel?.releaseIntervalBound ?? null,
    hasScoreCombinedScalar: typeof kernel?.scoreCombinedScalar === "function",
    hasScoreScalar: typeof kernel?.scoreScalar === "function",
    hasSpecializedKernel: Boolean(kernel),
    scoreKernel: kernel?.scoreKernel ?? null,
  }, null, 1))
}
