import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const base = fioniOptimizerInput()
const variants = Number(process.env.PROBE_VARIANTS ?? 3)

const slotMain = {
    1: { stat: "hpFlat", value: 2200 }, 2: { stat: "atkFlat", value: 316 }, 3: { stat: "defFlat", value: 184 },
    4: { stat: "anomalyProficiency", value: 92 }, 5: { stat: "fireDmg", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
const subStatPool = ["atkPct", "anomalyProficiency", "penFlat", "atkFlat", "critRate", "critDmg"]
function disc(id, setId, partition, variant) {
    return {
        id, ownerId: "default", setId, setName: setId, partition, rarity: "S", level: 15, maxLevel: 15,
        locked: false, equippedBy: null,
        mainStat: { ...slotMain[partition], label: slotMain[partition].stat },
        subStats: Array.from({ length: 4 }, (_, index) => {
            const stat = subStatPool[(variant + index + partition) % subStatPool.length]
            const value = stat === "atkPct" ? 3 + ((variant + partition) % 5) * 1.5
                : stat === "anomalyProficiency" ? 9 + ((variant + partition) % 5) * 9
                    : stat === "penFlat" ? 6 + ((variant + partition) % 5) * 3
                        : stat === "atkFlat" ? 19 + ((variant + partition) % 5) * 19
                            : stat === "critRate" ? 2.4 + ((variant + partition) % 4) * 1.2
                                : 4.8 + ((variant + partition) % 5) * 2.4
            return { stat, value, label: stat }
        }),
        source: { type: "probe", sequence: 1 },
    }
}
const driveDiscs = []
for (const slot of [1, 2, 3, 4, 5, 6]) for (let v = 0; v < variants; v += 1) {
    driveDiscs.push(disc(`f${slot}-${v}`, "phaethons_melody", slot, v))
    driveDiscs.push(disc(`h${slot}-${v}`, "hormone_punk", slot, v + variants))
}
const store = { version: 1, owners: [{ id: "default", label: "d" }], imports: [], driveDiscLoadouts: [], driveDiscs }

function run(label, payload) {
    const started = performance.now()
    const r = optimizeDriveDiscs(catalog, store, payload)
    const m = r.metrics ?? {}
    console.log(JSON.stringify({
        label, elapsedMs: Math.round(performance.now() - started),
        estimated: m.estimatedCombinationCount, evaluated: m.evaluated, scored: m.scoredCombinationCount,
        prunedSuperBound: m.prunedBySuperBound, prunedSuffixTopK: m.prunedBySuffixTopKBound,
        prunedGlobal: m.prunedByGlobalCutoff, superBoundChecks: m.superBoundChecks,
        dominanceMode: m.dominanceMode, scoreKernel: m.scoreKernel,
        evalPerSec: Math.round(m.evaluationsPerSecond ?? 0), top1: Math.round(r.results?.[0]?.score ?? 0),
    }))
}

const attr = structuredClone(base)
attr.damage.events = [{ ...attr.damage.events[0], settlementType: "attribute", triggerActorRef: undefined }]
const direct = structuredClone(base)
direct.damage.events = [{ id: "d", kind: "direct", skillMultiplier: 1.2, count: 1, stunned: true, critMode: "expected" }]
const noCore = structuredClone(base)
noCore.combatBuffs.activeBuffIds = noCore.combatBuffs.activeBuffIds.filter(id => id !== "agent:fioni.corePassive")

run("fioni release + core passive (current user path)", base)
run("fioni release without corePassive formula", noCore)
run("fioni attribute-only", attr)
run("fioni direct-only", direct)
