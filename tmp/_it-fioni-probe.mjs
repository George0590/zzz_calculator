import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(rootDir)

function createRng(seed) {
    let state = seed >>> 0
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 0x100000000
    }
}
function pick(rng, items) {
    return items[Math.floor(rng() * items.length)]
}
function subStatValue(stat, rng) {
    if (stat === "atkFlat") return 19 + Math.floor(rng() * 5) * 19
    if (stat === "anomalyProficiency") return 9 + Math.floor(rng() * 5) * 9
    return 3 + Math.floor(rng() * 5) * 1.5
}

const CASES = [
    { seed: 4101, coreSkillLevel: "A", cinemaLevel: 0, profileId: "fioni_purifying_flame_release", fourPieceSetId: "freedom_blues", twoPieceSetId: "phaethons_melody" },
    { seed: 4102, coreSkillLevel: "C", cinemaLevel: 2, profileId: "fioni_soul_searching_blaze_release", fourPieceSetId: "phaethons_melody", twoPieceSetId: "hormone_punk" },
    { seed: 4103, coreSkillLevel: "F", cinemaLevel: 4, profileId: "fioni_c4_extra_release", fourPieceSetId: "inferno_metal", twoPieceSetId: "freedom_blues" },
    { seed: 4104, coreSkillLevel: "A", cinemaLevel: 6, profileId: "fioni_soul_searching_blaze_release", fourPieceSetId: "freedom_blues", twoPieceSetId: "hormone_punk" },
]
const mainOptions = {
    1: [{ stat: "hpFlat", value: 2200 }],
    2: [{ stat: "atkFlat", value: 316 }],
    3: [{ stat: "defFlat", value: 184 }],
    4: [
        { stat: "anomalyProficiency", value: 92 },
        { stat: "atkPct", value: 30, mode: "pct" },
    ],
    5: [
        { stat: "fireDmg", value: 30, mode: "pct" },
        { stat: "atkPct", value: 30, mode: "pct" },
        { stat: "penRatio", value: 24, mode: "pct" },
    ],
    6: [
        { stat: "anomalyMastery", value: 30, mode: "pct" },
        { stat: "atkPct", value: 30, mode: "pct" },
    ],
}
const subStatPool = ["anomalyProficiency", "atkPct", "atkFlat", "penRatio", "dmgBonus"]

function releaseDisc(scenario, scenarioIndex, setId, setIndex, slot, variant, rng) {
    const options = mainOptions[slot]
    const mainStat = options[(scenarioIndex + setIndex + slot + variant) % options.length]
    const used = new Set([mainStat.stat])
    const subStats = []
    while (subStats.length < 3) {
        const stat = pick(rng, subStatPool)
        if (used.has(stat)) continue
        used.add(stat)
        subStats.push({ stat, value: subStatValue(stat, rng), mode: "pct", label: stat })
    }
    return {
        id: `fioni-release-${scenario.seed}-${setIndex}-${slot}-${variant}`,
        ownerId: "default",
        setId,
        setName: catalog.driveDiscSetsMap.get(setId)?.name?.zhCN ?? setId,
        partition: slot,
        rarity: "S",
        level: 15,
        maxLevel: 15,
        locked: false,
        equippedBy: null,
        reservedForAgentId: null,
        mainStat: { ...mainStat, mode: mainStat.mode ?? "flat", label: mainStat.stat },
        subStats,
        source: { type: "release-fuzz", sequence: scenario.seed * 100 + setIndex * 20 + slot * 2 + variant },
    }
}

function releaseStore(scenario, scenarioIndex) {
    const rng = createRng(scenario.seed)
    return {
        version: 1,
        currentOwnerId: "default",
        owners: [{ id: "default", label: "默认用户" }],
        imports: [],
        driveDiscLoadouts: [],
        driveDiscs: [scenario.fourPieceSetId, scenario.twoPieceSetId].flatMap((setId, setIndex) =>
            [1, 2, 3, 4, 5, 6].flatMap(slot => [0, 1].map(variant =>
                releaseDisc(scenario, scenarioIndex, setId, setIndex, slot, variant, rng),
            )),
        ),
    }
}

function releaseInput(scenario, algorithm) {
    const activeBuffIds = [
        "agent:fioni.corePassive",
        "agent:fioni.additionalAbility",
        "agent:fioni.skill.release_crit_dmg",
    ]
    for (const level of [1, 2, 6]) {
        if (scenario.cinemaLevel >= level) activeBuffIds.push(`agent:fioni.cinema.${level}`)
    }
    return {
        agentId: "fioni",
        coreSkillLevel: scenario.coreSkillLevel,
        cinemaLevel: scenario.cinemaLevel,
        wEngineId: "zzz_wiki_154",
        wEngineModificationLevel: 1,
        driveDiscs: [],
        combatBuffs: { activeBuffIds },
        damage: {
            mode: "anomaly",
            selectedEventId: "fioni-fuzz-release",
            events: [{
                id: "fioni-fuzz-release",
                kind: "anomaly",
                settlementType: "release",
                anomalyEffect: "burn",
                count: 1,
                stunned: true,
                critMode: "expected",
                triggerActorRef: { agentId: "fioni", profileId: scenario.profileId },
                anomalySource: { actorRef: { agentId: "fioni" } },
            }],
            target: {
                defense: 953,
                levelCoefficient: 794,
                resistanceByElement: { fire: 0 },
            },
            skillLevelsByCategory: { basic: 12, chain: 12 },
        },
        settings: {
            objective: "damage",
            algorithm,
            fourPieceSetId: scenario.fourPieceSetId,
            twoPieceSetId: scenario.twoPieceSetId,
            mainStatLimits: {
                4: ["anomalyProficiency", "atkPct"],
                5: ["fireDmg", "atkPct", "penRatio"],
                6: ["anomalyMastery", "atkPct"],
            },
            minimums: {},
            disableParallel: true,
            enableUpperBoundPruning: algorithm !== "exact-legacy",
        },
    }
}

function topSignature(result) {
    return result.results.map(item => ({
        ids: item.driveDiscs.map(disc => disc.id).join("|"),
        score: Number(item.score.toFixed(6)),
    }))
}

for (const [scenarioIndex, scenario] of CASES.entries()) {
    const store = releaseStore(scenario, scenarioIndex)
    const legacy = optimizeDriveDiscs(catalog, store, releaseInput(scenario, "exact-legacy"))
    const superBound = optimizeDriveDiscs(catalog, store, releaseInput(scenario, "exact-super-bound"))
    const m = superBound.metrics
    const same = JSON.stringify(topSignature(legacy)) === JSON.stringify(topSignature(superBound))
    console.log(JSON.stringify({
        label: `${scenario.coreSkillLevel}/C${scenario.cinemaLevel}/${scenario.profileId}/${scenario.fourPieceSetId}+${scenario.twoPieceSetId}`,
        legacyResults: legacy.results.length,
        results: superBound.results.length,
        topMatch: same,
        estimated: m.estimatedCombinationCount,
        scored: m.scoredCombinationCount,
        pruned: m.prunedBySuperBound,
        superBoundChecks: m.superBoundChecks,
        releaseIntervalBoundEnabled: m.releaseIntervalBoundEnabled,
        releaseBoundFallbackReason: m.releaseBoundFallbackReason,
        strictExact: m.strictExact,
        candidateCountsBySlot: m.candidateCountsBySlot,
        topScore: superBound.results[0]?.score,
        legacyTopScore: legacy.results[0]?.score,
    }))
}
