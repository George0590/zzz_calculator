import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext, calculateInCombatPanel } from "../backend/calculator.js"
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
    assert.equal(events.length, potential === 0 ? 11 : 18)
    assert.equal(events.filter(event => event.input.skillSource.moveId === "ultimate_endless_winter").length, 2)
    assert.equal(events.filter(event => event.input.skillSource.moveId === "frost_edge_large").length, potential === 0 ? 0 : 3)
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
console.log("Ellen integration: catalog, P0/P1/P6 targets, stacks, rotation and merged scaling passed")
