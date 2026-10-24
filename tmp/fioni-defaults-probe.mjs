// Read-only probe: compare optimizer default candidate space / pruning for fioni vs velina.
// Writes nothing; prints metrics as JSON lines.
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const agents = catalog.agentsMap

function agentDefaults(agentId) {
  const agent = agents.get(agentId)
  return {
    fourPieceSetId: (agent.preferredDriveDiscs?.defaultSetIds ?? [])[0],
    twoPieceSetIds: agent.preferredDriveDiscs?.defaultTwoPieceSetIds ?? [],
    mainStatLimits: agent.preferredDriveDiscs?.mainStatLimits ?? {},
    events: JSON.parse(JSON.stringify(agent.defaultCalculationConfig?.events ?? [])),
  }
}

const PCT_MAINS = new Set(["atkPct", "penRatio", "anomalyMastery", "energyRegen", "fireDmg", "windDmg", "physicalDmg", "hpPct", "defPct"])

function makeStore({ sets, mainBySlot, variants }) {
  const driveDiscs = []
  for (let slot = 1; slot <= 6; slot += 1) {
    const mains = mainBySlot[String(slot)] ?? ["hpFlat"]
    for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
      for (let variant = 0; variant < variants; variant += 1) {
        const stat = mains[variant % mains.length]
        driveDiscs.push({
          id: `d-${slot}-${setIndex}-${variant}`,
          ownerId: "default",
          partition: slot,
          setId: sets[setIndex],
          rarity: "S",
          level: 15,
          maxLevel: 15,
          mainStat: { stat, value: PCT_MAINS.has(stat) ? 30 : 100, mode: "flat" },
          subStats: [
            { stat: "atkPct", value: 3 + variant * 6 },
            { stat: "anomalyProficiency", value: 9 + ((variant + slot + setIndex) % Math.max(1, variants)) * 9 },
          ].filter(sub => sub.stat !== stat),
          source: { type: "probe", sequence: slot * 1000 + setIndex * 100 + variant },
        })
      }
    }
  }
  return { version: 1, currentOwnerId: "default", owners: [{ id: "default", label: "probe" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

const fioni = agentDefaults("fioni")
const velina = agentDefaults("velina")

function report(label, { result, wallMs }) {
  const m = result.metrics ?? {}
  if (process.env.PROBE_FULL_METRICS === "1") {
    console.log(`## FULL METRICS ${label}`)
    console.log(JSON.stringify(m, null, 1))
  }
  console.log(JSON.stringify({
    label,
    wallMs,
    estimated: m.estimatedCombinationCount,
    processed: m.processedCombinationCount,
    evaluated: m.evaluated,
    prunedBySuperBound: m.prunedBySuperBound,
    prunedByUpperBound: m.prunedByUpperBound,
    prunedBySuffixTopKBound: m.prunedBySuffixTopKBound,
    superBoundChecks: m.superBoundChecks,
    denseScoreCalls: m.denseScoreCalls,
    specializedScoreCalls: m.specializedScoreCalls,
    scoreKernelFallbackReason: m.scoreKernelFallbackReason ?? null,
    strictExact: m.strictExact,
    preparationMs: m.preparationMs ?? null,
    totalMs: m.totalMs ?? m.elapsedMs ?? null,
    candidateCountsBySlot: m.candidateCountsBySlot,
    resultCount: result.results?.length ?? 0,
    settingsApplied: {
      fourPieceSetIds: result.settings?.fourPieceSetIds,
      twoPieceSetIds: result.settings?.twoPieceSetIds,
      mainStatLimits: result.settings?.mainStatLimits,
    },
  }, null, 1))
}

function runCase(label, { store, input, settingsOverride = {} }) {
  const request = {
    ...input,
    settings: { ...input.settings, ...settingsOverride, algorithm: "exact-super-bound", objective: "damage" },
  }
  const started = Date.now()
  const result = optimizeDriveDiscs(catalog, store, request)
  report(label, { result, wallMs: Date.now() - started })
}

const variants = Number(process.env.PROBE_VARIANTS ?? 2)

const baseSlots = { 1: ["hpFlat"], 2: ["atkFlat"], 3: ["defFlat"] }
const fioniMains = { ...baseSlots, 4: fioni.mainStatLimits["4"], 5: fioni.mainStatLimits["5"], 6: fioni.mainStatLimits["6"] }
const velinaMains = { ...baseSlots, 4: velina.mainStatLimits["4"], 5: velina.mainStatLimits["5"], 6: ["energyRegen", "atkPct"] }

// fioni store keeps a third set so restricted vs unrestricted 2-piece can share one inventory
const fioniStore = makeStore({ sets: [fioni.fourPieceSetId, ...fioni.twoPieceSetIds, "hormone_punk"], mainBySlot: fioniMains, variants })
const fioniInput = {
  agentId: "fioni",
  coreSkillLevel: "F",
  cinemaLevel: 0,
  wEngineId: "zzz_wiki_154",
  wEngineModificationLevel: 1,
  combatBuffs: { activeBuffIds: ["agent:fioni.corePassive", "agent:fioni.additionalAbility", "agent:fioni.skill.release_crit_dmg"] },
  damage: { mode: "custom", selectedEventId: fioni.events[0].id, events: fioni.events },
  settings: { fourPieceSetIds: [fioni.fourPieceSetId], twoPieceSetIds: fioni.twoPieceSetIds },
}
const attributeEvents = fioni.events.map(event => {
  const copy = { ...event, settlementType: "attribute" }
  delete copy.triggerActorRef
  delete copy.releaseSkillRef
  return copy
})
const fioniAttributeInput = { ...fioniInput, damage: { mode: "custom", selectedEventId: "attribute", events: attributeEvents } }

const velinaStore = makeStore({ sets: [velina.fourPieceSetId, ...velina.twoPieceSetIds], mainBySlot: velinaMains, variants })
const velinaInput = {
  agentId: "velina",
  coreSkillLevel: "F",
  cinemaLevel: 0,
  wEngineId: "zzz_wiki_2030",
  wEngineModificationLevel: 1,
  combatBuffs: { activeBuffIds: ["agent:velina.corePassive"] },
  damage: { mode: "custom", selectedEventId: velina.events[0].id, events: velina.events },
  settings: { fourPieceSetIds: [velina.fourPieceSetId], twoPieceSetIds: velina.twoPieceSetIds },
}

console.log("## default configs")
console.log(JSON.stringify({ fioni, velina }, null, 1))
console.log(`## variants=${variants} (${variants} discs per set per slot)`)

const cases = {
  "A": () => runCase("A fioni-default release event", { store: fioniStore, input: fioniInput }),
  "A'": () => runCase("A' fioni same inventory/event downgraded to attribute", { store: fioniStore, input: fioniAttributeInput }),
  "B": () => runCase("B fioni twoPiece unrestricted []", { store: fioniStore, input: fioniInput, settingsOverride: { twoPieceSetIds: [] } }),
  "C": () => runCase("C velina-default attribute event", { store: velinaStore, input: velinaInput }),
  "C'": () => runCase("C' velina twoPiece unrestricted []", { store: velinaStore, input: velinaInput, settingsOverride: { twoPieceSetIds: [] } }),
}
const only = String(process.env.PROBE_ONLY ?? "").split(",").map(item => item.trim()).filter(Boolean)
for (const [key, run] of Object.entries(cases)) {
  if (only.length && !only.includes(key)) continue
  run()
}
