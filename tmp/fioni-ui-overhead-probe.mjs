// Read-only probe: quantify browser-Worker overhead knobs (yield/progress interval) and one-time catalog clone cost.
import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { previewDriveDiscOptimization } from "../backend/driveDiscOptimizer.js"
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

// smaller inventory so each timing run stays a few seconds
const reduced = { ...store, driveDiscs: store.driveDiscs.filter(disc => Number(disc.partition) > 3 || disc.source?.sequence % 3 === 0) }
const preview = previewDriveDiscOptimization(catalog, reduced, input)
console.log(JSON.stringify({ reducedEstimated: preview.metrics?.estimatedCombinationCount, candidates: preview.metrics?.candidateCountsBySlot }))

const browserRuntime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)) })
const variants = [
  { label: "worker default (chunk5000, progress200, yield50)", options: { chunkSize: 5000, progressIntervalMs: 200, yieldIntervalMs: 50 } },
  { label: "no-yield knob (progress1000, yield1000)", options: { chunkSize: 5000, progressIntervalMs: 1000, yieldIntervalMs: 1000 } },
  { label: "chunk 20000, progress 200, yield 50", options: { chunkSize: 20000, progressIntervalMs: 200, yieldIntervalMs: 50 } },
]
for (const variant of variants) {
  let progressCount = 0
  const started = Date.now()
  const result = await browserRuntime.optimizeDriveDiscsAsync(catalog, reduced, input, {
    ...variant.options,
    onProgress: () => { progressCount += 1 },
  })
  console.log(JSON.stringify({
    label: variant.label,
    wallMs: Date.now() - started,
    progressCount,
    evaluated: result.metrics?.evaluated,
    evalsPerSecond: Math.round(Number(result.metrics?.evaluated ?? 0) / ((Date.now() - started) / 1000)),
  }))
}

// one-time catalog clone cost (store.cloneWorkerPayload + postMessage structured clone)
function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) return new Date(value)
  if (value instanceof Map) { const out = new Map(); seen.set(value, out); for (const [k, v] of value) out.set(deepClone(k, seen), deepClone(v, seen)); return out }
  if (value instanceof Set) { const out = new Set(); seen.set(value, out); for (const v of value) out.add(deepClone(v, seen)); return out }
  if (Array.isArray(value)) { const out = []; seen.set(value, out); for (const v of value) out.push(deepClone(v, seen)); return out }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out = {}
  seen.set(value, out)
  for (const [k, v] of Object.entries(value)) { if (typeof v === "function" || typeof v === "symbol") continue; out[k] = deepClone(v, seen) }
  return out
}
let started = Date.now()
const cloned = deepClone(catalog)
const cloneMs = Date.now() - started
started = Date.now()
structuredClone(cloned)
console.log(JSON.stringify({ catalogJsonBytes: JSON.stringify(catalog).length, deepCloneMs: cloneMs, structuredCloneMs: Date.now() - started }))
