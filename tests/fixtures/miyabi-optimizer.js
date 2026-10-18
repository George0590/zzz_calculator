// Synthetic inventory: fixed generation order and legal main/sub-stat pairs.
// This is a reproducible performance fixture, not a player's inventory.
export function miyabiOptimizerFixture(catalog, variants = 4) {
    const fourSet = "scanner-set-48ee0a14625f"
    const twoSets = ["puffer_electro", "hormone_punk", "zzz_wiki_1001", "woodpecker_electro"]
    const rolls = { atkPct: 3, critRate: 2.4, critDmg: 4.8, anomalyProficiency: 9, penFlat: 9, atkFlat: 19 }
    const stats = Object.keys(rolls)
    const percentStats = new Set(["atkPct", "critRate", "critDmg", "penRatio"])
    const driveDiscs = []
    for (let slot = 1; slot <= 6; slot++) {
        for (const [setIndex, setId] of [fourSet, ...twoSets].entries()) {
            for (let variant = 0; variant < variants; variant++) {
                const mains = {
                    1: ["hpFlat", 2200], 2: ["atkFlat", 316], 3: ["defFlat", 184],
                    4: [["critRate", "critDmg", "atkPct", "anomalyProficiency"][variant % 4], [24, 48, 30, 92][variant % 4]],
                    5: [variant % 2 ? "penRatio" : "atkPct", variant % 2 ? 24 : 30],
                    6: ["atkPct", 30],
                }
                const [stat, value] = mains[slot]
                const subStats = []
                for (let j = 0; subStats.length < 4; j++) {
                    const sub = stats[(variant + setIndex + slot + j) % stats.length]
                    if (sub === stat || subStats.some(item => item.stat === sub)) continue
                    subStats.push({ stat: sub, value: rolls[sub] * (1 + (variant + setIndex + j) % 4), mode: percentStats.has(sub) ? "pct" : "flat" })
                }
                driveDiscs.push({
                    id: `fixture-${slot}-${setIndex}-${variant}`, ownerId: "default", setId, partition: slot,
                    rarity: "S", level: 15, maxLevel: 15,
                    mainStat: { stat, value, mode: percentStats.has(stat) ? "pct" : "flat" }, subStats,
                    source: { type: "benchmark", sequence: driveDiscs.length },
                })
            }
        }
    }
    return {
        store: { version: 1, currentOwnerId: "default", owners: [{ id: "default", label: "benchmark" }], driveDiscs, imports: [], driveDiscLoadouts: [] },
        input: {
            agentId: "hoshimi_miyabi", agentLevel: 60, coreSkillLevel: "F", cinemaLevel: 0,
            wEngineId: "hailfall_star_palace", wEngineLevel: 60, wEngineModificationLevel: 1,
            combatBuffs: { activeBuffIds: [] }, damage: catalog.agentsMap.get("hoshimi_miyabi").defaultCalculationConfig,
            settings: {
                algorithm: "exact-super-bound", fourPieceSetId: fourSet, twoPieceSetIds: twoSets,
                mainStatLimits: { 4: ["atkPct", "critRate", "critDmg", "anomalyProficiency"], 5: ["penRatio", "atkPct"], 6: ["atkPct"] },
                minimums: Object.fromEntries(["atk", "def", "anomalyProficiency", "critRate", "critDmg", "lacerationDmg"].map(key => [key, null])),
            },
        },
    }
}
