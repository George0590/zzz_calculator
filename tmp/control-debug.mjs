import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(root)
const example = catalog.examples.yeShunguang.input
console.log("example keys", Object.keys(example), "agentId", example.agentId)
console.log("settings", JSON.stringify(example.settings))
const variants = 3
const sets = { four: "woodpecker_electro", two: "hormone_punk" }
const mains = {
    1: { stat: "hpFlat", value: 2200 }, 2: { stat: "atkFlat", value: 316 }, 3: { stat: "defFlat", value: 184 },
    4: { stat: "critRate", value: 24, mode: "pct" }, 5: { stat: "electricDmg", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
const driveDiscs = []
for (const slot of [1, 2, 3, 4, 5, 6]) for (let v = 0; v < variants; v += 1) {
    for (const [prefix, setId] of [["f", sets.four], ["h", sets.two]]) {
        driveDiscs.push({
            id: `${prefix}${slot}-${v}`, ownerId: "default", setId, setName: setId, partition: slot,
            rarity: "S", level: 15, maxLevel: 15, locked: false, equippedBy: null,
            mainStat: { ...mains[slot], label: mains[slot].stat },
            subStats: [{ stat: "atkPct", value: 6, label: "atkPct" }, { stat: "critRate", value: 4.8, label: "critRate" },
                { stat: "critDmg", value: 9.6, label: "critDmg" }, { stat: "penRatio", value: 6, label: "penRatio" }],
            source: { type: "probe", sequence: slot * 10 + v },
        })
    }
}
const store = { version: 1, owners: [{ id: "default", label: "d" }], imports: [], driveDiscLoadouts: [], driveDiscs }
const input = {
    ...example,
    combatBuffs: { activeBuffIds: [] },
    settings: { fourPieceSetId: sets.four, twoPieceSetId: sets.two, objective: "damage", algorithm: "exact-super-bound" },
}
const r = optimizeDriveDiscs(catalog, store, input)
console.log("results", r.results.length, "metrics keys", Object.keys(r.metrics ?? {}).join(","))
console.log(JSON.stringify({ estimated: r.metrics?.estimatedCombinationCount, candidateCountsBySlot: r.metrics?.candidateCountsBySlot, planBuildMs: r.metrics?.planBuildMs, results: r.results.length }, null, 1))
