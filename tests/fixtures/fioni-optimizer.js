export function fioniOptimizerInput() {
    return {
        agentId: "fioni", coreSkillLevel: "F", cinemaLevel: 0,
        wEngineId: "zzz_wiki_154", wEngineModificationLevel: 1,
        combatBuffs: { activeBuffIds: ["agent:fioni.corePassive", "agent:fioni.additionalAbility", "driveDisc4pc:phaethons_melody.self"] },
        damage: { mode: "custom", agentLevel: 60, skillLevelsByCategory: { basic: 12, chain: 12 },
            selectedEventId: "release", events: [{ id: "release", kind: "anomaly", settlementType: "release",
                anomalyEffect: "burn", count: 1, stunned: true, critMode: "expected",
                triggerActorRef: { agentId: "fioni", profileId: "fioni_purifying_flame_release" },
                anomalySource: { actorRef: { agentId: "fioni" } } }] },
        settings: { fourPieceSetId: "phaethons_melody", twoPieceSetId: "hormone_punk", algorithm: "exact-super-bound",
            objective: "damage", topN: 10,
            mainStatLimits: { 4: ["anomalyProficiency"], 5: ["fireDmg"], 6: ["atkPct", "anomalyMastery"] } },
    }
}

export function fioniOptimizerStore() {
    const main = [null, ["hpFlat", 2200], ["atkFlat", 316], ["defFlat", 184], ["anomalyProficiency", 92], ["fireDmg", 30], ["atkPct", 30]]
    const driveDiscs = []
    for (let slot = 1; slot <= 6; slot++) for (let variant = 0; variant < 2; variant++) {
        const [stat, value] = slot === 6 && variant ? ["anomalyMastery", 30] : main[slot]
        driveDiscs.push({ id: `fioni-${slot}-${variant}`, ownerId: "default", partition: slot,
            setId: slot <= 4 ? "phaethons_melody" : "hormone_punk", rarity: "S", level: 15, maxLevel: 15,
            mainStat: { stat, value },
            subStats: [{ stat: "atkPct", value: 3 + variant * 6 }, { stat: "anomalyProficiency", value: 9 + (1 - variant) * 18 },
                { stat: "penFlat", value: slot + variant * (9 + 2 ** slot / 100) }].filter(s => s.stat !== stat),
            source: { type: "test", sequence: slot * 100 + variant } })
    }
    return { version: 1, currentOwnerId: "default", owners: [{ id: "default", label: "Synthetic" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}
