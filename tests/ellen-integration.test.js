import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext, calculateInCombatPanel, createInCombatPanelCalculator } from "../backend/calculator.js"
import { materializeCorePassiveScalingRule } from "../core/corePassiveScaling.js"
import { resolveDefaultCalculationConfig } from "../core/defaultCalculationConfig.js"
import { validateMaintenanceItem } from "../core/maintenanceValidation.js"

// Integration smoke coverage; this does not certify the reference rotation's timing.
const catalog = await loadCalculatorContext(fileURLToPath(new URL("../", import.meta.url)))
const agent = catalog.agentsMap.get("ellen_joe")
assert.deepEqual(validateMaintenanceItem("agents", agent, catalog), { ok: true, errors: [] })
assert.deepEqual(validateMaintenanceItem("agentSkills", catalog.agentSkillsMap.get(agent.id), catalog), { ok: true, errors: [] })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

function calculate(potentialLevel, stacks = 10) {
    const config = resolveDefaultCalculationConfig(agent.defaultCalculationConfig, 0, potentialLevel)
    return calculateInCombatPanel(catalog, {
        agentId: agent.id, coreSkillLevel: "F", cinemaLevel: 0, potentialLevel,
        wEngineId: "zzz_wiki_225", driveDiscs: [],
        combatBuffs: {
            activeBuffIds: ["agent:ellen_joe.corePassive", "agent:ellen_joe.additionalAbility"],
            runtimeInputs: {
                "agent:ellen_joe.additionalAbility": {
                    effects: Object.fromEntries(agent.combatBuffs.additionalAbility.effects.map(rule => [rule.id, { stacks }])),
                },
            },
        },
        damage: { ...config, mode: "custom" },
    })
}

for (const [potential, extraCrit] of [[0, 0], [1, 0], [6, 0.48]]) {
    const result = calculate(potential)
    assert.ok(result.damage.totalFinalDamage > 0)
    const events = result.damage.events
    assert.equal(events.length, potential === 0 ? 7 : 10)
    assert.equal(events.filter(event => event.input.skillSource.moveId === "ultimate_endless_winter").length, 1)
    assert.equal(events.filter(event => event.input.skillSource.moveId === "frost_edge_large").length, potential === 0 ? 0 : 1)
    assert.equal(events.reduce((sum, event) => sum + event.input.count, 0), potential === 0 ? 11 : 18)
    const config = resolveDefaultCalculationConfig(agent.defaultCalculationConfig, 0, potential)
    const expectedCounts = potential === 0
        ? { ultimate_1: 2, basic_string_1: 2, ex_1: 1, ex_2: 1, chain_1: 1 }
        : { ultimate_1: 2, basic_string_1: 2, frost_edge_1: 3, icy_waves_1: 2, ex_1: 1, ex_2: 1, chain_1: 1 }
    assert.deepEqual(Object.fromEntries(config.events.map(event => [event.id, event.count])), expectedCounts)
    assert.equal(config.selectedEventId, "ultimate_1")
    // Reconstruct the original ordered rotation independently of aggregate counts.
    const order = potential === 0
        ? ["ultimate_1", "basic_string_1", "ex_1", "ex_2", "chain_1", "ultimate_1", "basic_string_1"]
        : ["ultimate_1", "basic_string_1", "frost_edge_1", "icy_waves_1", "ex_1", "ex_2", "frost_edge_1", "chain_1", "ultimate_1", "basic_string_1", "frost_edge_1", "icy_waves_1"]
    const originalEvents = order.map((id, index) => ({ ...structuredClone(config.events.find(event => event.id === id)), id: 'original_' + index, count: 1 }))
    const input = { agentId: agent.id, coreSkillLevel: "F", cinemaLevel: 0, potentialLevel: potential,
        wEngineId: "zzz_wiki_225", driveDiscs: [],
        combatBuffs: { activeBuffIds: ["agent:ellen_joe.corePassive", "agent:ellen_joe.additionalAbility"] },
        damage: { ...config, mode: "custom" } }
    const original = calculateInCombatPanel(catalog, { ...input, damage: { ...input.damage, events: originalEvents, selectedEventId: "original_0" } })
    const aggregated = calculateInCombatPanel(catalog, input)
    assert.ok(Math.abs(aggregated.damage.totalFinalDamage - original.damage.totalFinalDamage) <= Math.max(1, original.damage.totalFinalDamage) * 1e-8)
    const compiled = createInCombatPanelCalculator(catalog, input)
    near(compiled.scoreOnlyFromSummary(new Map(), new Map()).finalDamage,
        compiled.scoreOnlyFromSummaryLegacy(new Map(), new Map()).finalDamage)
    for (const event of events) {
        const move = event.input.skillSource.moveId
        const coreApplies = move === "flash_freeze_trimming"
            || (potential >= 1 && ["ultimate_endless_winter", "chain_avalanche", "icy_waves", "frost_edge_large"].includes(move))
        near(event.panelSnapshot.targetedCritDmgBonus, coreApplies ? 1 : 0)
        near(event.panelSnapshot.critDmg, 0.5 + extraCrit + (coreApplies ? 1 : 0))
    }
}

for (const [stacks, ice, crit, ignore] of [[0, 0, 0, 0], [9, 0.27, 0.432, 0], [10, 0.3, 0.48, 0.1]]) {
    const result = calculate(6, stacks)
    near(result.inCombat.panel.iceDmg, ice)
    near(result.inCombat.panel.critDmg, 0.5 + crit)
    near(result.inCombat.panel.iceResIgnore, ignore)
}

const targetedAgent = structuredClone(agent)
targetedAgent.combatBuffs.corePassive.effects.push(
    {
        id: "targeted-crit-rate-probe",
        type: "fixed",
        stat: "critRate",
        value: 25,
        mode: "flat",
        target: {
            kind: "skill",
            skillTargets: [{
                kind: "specific",
                agentSkillId: "ellen_joe",
                categoryId: "basic",
                skillType: "basic",
                moveId: "flash_freeze_trimming",
            }],
        },
    },
    {
        id: "targeted-crit-dmg-probe",
        type: "fixed",
        stat: "critDmg",
        value: 50,
        mode: "flat",
        target: {
            kind: "skill",
            skillTargets: [{
                kind: "specific",
                agentSkillId: "ellen_joe",
                categoryId: "basic",
                skillType: "basic",
                moveId: "flash_freeze_trimming",
            }],
        },
    },
)
const targetedCatalog = {
    ...catalog,
    agents: catalog.agents.map(item => item.id === targetedAgent.id ? targetedAgent : item),
    agentsMap: new Map(catalog.agentsMap).set(targetedAgent.id, targetedAgent),
}
assert.deepEqual(validateMaintenanceItem("agents", targetedAgent, targetedCatalog), { ok: true, errors: [] })
const probeEvents = [
    { id: "targeted", kind: "direct", count: 1, stunned: true, critMode: "expected", skillRef: { agentSkillId: "ellen_joe", categoryId: "basic", moveId: "flash_freeze_trimming", rowId: "hit_1" } },
    { id: "unmatched", kind: "direct", count: 1, stunned: true, critMode: "expected", skillRef: { agentSkillId: "ellen_joe", categoryId: "special", moveId: "ex_tail_swipe", rowId: "damage" } },
]
const targetedResult = calculateInCombatPanel(targetedCatalog, {
    agentId: "ellen_joe", coreSkillLevel: "F", cinemaLevel: 0, potentialLevel: 0,
    wEngineId: "zzz_wiki_225", driveDiscs: [],
    combatBuffs: { activeBuffIds: ["agent:ellen_joe.corePassive"], runtimeInputs: {} },
    damage: { mode: "custom", selectedEventId: "targeted", events: probeEvents },
})
const targetedEvent = targetedResult.damage.events.find(event => event.id === "targeted")
const unmatchedEvent = targetedResult.damage.events.find(event => event.id === "unmatched")
assert.equal(targetedEvent.panelSnapshot.targetedCritRateBonus, 0.25)
assert.equal(targetedEvent.panelSnapshot.targetedCritDmgBonus, 1.5)
assert.equal(unmatchedEvent.panelSnapshot.targetedCritRateBonus, 0)
assert.equal(unmatchedEvent.panelSnapshot.targetedCritDmgBonus, 0)
assert.ok(targetedEvent.panelSnapshot.effectiveCritRate > unmatchedEvent.panelSnapshot.effectiveCritRate)
assert.ok(targetedEvent.damageVariants.expected.critMultiplier > unmatchedEvent.damageVariants.expected.critMultiplier)
const compiledProbe = createInCombatPanelCalculator(targetedCatalog, {
    agentId: "ellen_joe", coreSkillLevel: "F", cinemaLevel: 0, potentialLevel: 0,
    wEngineId: "zzz_wiki_225", driveDiscs: [],
    combatBuffs: { activeBuffIds: ["agent:ellen_joe.corePassive"], runtimeInputs: {} },
    damage: { mode: "custom", selectedEventId: "targeted", events: probeEvents },
})
near(compiledProbe.scoreOnlyFromSummary(new Map(), new Map()).finalDamage,
    compiledProbe.scoreOnlyFromSummaryLegacy(new Map(), new Map()).finalDamage)

// The merge must keep both formula-parameter growth and stack-value growth.
const growingAgent = { id: "scaling_probe", coreSkill: {
    defaultLevel: "A", levels: [{ level: "A" }],
    corePassiveScaling: { levels: [{ amount: 2 }, { amount: 4 }] },
} }
const stacked = { type: "stacked", value: 2, valueSource: { kind: "corePassiveScaling", field: "amount" } }
near(materializeCorePassiveScalingRule(stacked, growingAgent, "A").valuePerStack, 4)
const threshold = materializeCorePassiveScalingRule({ ...stacked, activationStacks: 10 }, growingAgent, "A")
near(threshold.value, 4)
assert.equal(threshold.valuePerStack, undefined)
const formula = materializeCorePassiveScalingRule({
    type: "formula", formula: { parameters: { rate: 2 }, parameterSources: { rate: { kind: "corePassiveScaling", field: "amount" } } },
}, growingAgent, "A")
near(formula.formula.parameters.rate, 4)

const potentialSkillAgent = structuredClone(agent)
potentialSkillAgent.combatBuffs.skillBuffs.push({
    id: "potential-skill-probe",
    name: { zhCN: "潜能技能条件验证" },
    description: { zhCN: "P1至P5生效" },
    defaultChecked: true,
    scope: "inCombat",
    sourceSkillRef: {
        agentSkillId: "ellen_joe",
        categoryId: "basic",
        moveId: "flash_freeze_trimming",
    },
    effects: [{
        id: "potential-skill-probe-effect",
        type: "fixed",
        stat: "critDmg",
        value: 77,
        mode: "flat",
        requirement: { minPotentialLevel: 1, maxPotentialLevel: 5 },
    }],
})
const potentialSkillCatalog = {
    ...catalog,
    agents: catalog.agents.map(item => item.id === potentialSkillAgent.id ? potentialSkillAgent : item),
    agentsMap: new Map(catalog.agentsMap).set(potentialSkillAgent.id, potentialSkillAgent),
}
for (const [potentialLevel, expected] of [[0, 0], [1, 77], [5, 77], [6, 0]]) {
    const result = calculateInCombatPanel(potentialSkillCatalog, {
        agentId: "ellen_joe",
        coreSkillLevel: "F",
        cinemaLevel: 0,
        potentialLevel,
        wEngineId: "zzz_wiki_225",
        driveDiscs: [],
        combatBuffs: { activeBuffIds: ["agent:ellen_joe.skill.potential-skill-probe"], runtimeInputs: {} },
        damage: {
            mode: "custom",
            selectedEventId: "potential-skill-probe-event",
            events: [{
                id: "potential-skill-probe-event",
                kind: "direct",
                count: 1,
                stunned: true,
                critMode: "expected",
                skillRef: {
                    agentSkillId: "ellen_joe",
                    categoryId: "basic",
                    moveId: "flash_freeze_trimming",
                    rowId: "hit_1",
                },
            }],
        },
    })
    const event = result.damage.events[0]
    const baselineResult = calculateInCombatPanel(potentialSkillCatalog, {
        agentId: "ellen_joe",
        coreSkillLevel: "F",
        cinemaLevel: 0,
        potentialLevel,
        wEngineId: "zzz_wiki_225",
        driveDiscs: [],
        combatBuffs: { activeBuffIds: [], runtimeInputs: {} },
        damage: {
            mode: "custom",
            selectedEventId: "potential-skill-probe-event",
            events: [event.input],
        },
    })
    const baselineEvent = baselineResult.damage.events[0]
    const baseline = potentialLevel >= 1 && potentialLevel <= 5 ? 0.77 : 0
    assert.equal(Number(event.panelSnapshot.critDmg) - Number(baselineEvent.panelSnapshot.critDmg), baseline)
}
console.log("Ellen integration: catalog, P0/P1/P6 targets, stacks, rotation and merged scaling passed")
