// 只读探针：验证菲欧妮严格优化器剪枝失效的代码链路。
// 不修改仓库源码/data，仅读取 data/ 与 tests/fixtures/。
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCalculatorContext, createInCombatPanelCalculator } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"
import {
    isInitialMasteryAnomalyCritRule,
    isInCombatFormulaRule,
    isOutOfCombatFormulaRule,
} from "../core/effectFormula.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const catalog = await loadCalculatorContext(rootDir)
const fioni = catalog.agentsMap.get("fioni")

console.log("=== 0) fioni corePassive 规则与分类判定 ===")
for (const rule of fioni.combatBuffs.corePassive.effects) {
    console.log(JSON.stringify({
        id: rule.id,
        type: rule.type,
        stat: rule.stat,
        scope: rule.scope ?? null,
        targetKind: rule.target?.kind ?? null,
        settlementTypes: rule.target?.settlementTypes ?? null,
        sourceKind: rule.source?.kind ?? null,
        sourceStat: rule.source?.stat ?? null,
        sourceUnit: rule.source?.unit ?? null,
        expression: rule.formula?.expression ?? null,
        valueUnit: rule.formula?.valueUnit ?? null,
        predicate_isInCombatFormulaRule: isInCombatFormulaRule(rule),
        predicate_isOutOfCombatFormulaRule: isOutOfCombatFormulaRule(rule),
        predicate_isInitialMasteryAnomalyCritRule: isInitialMasteryAnomalyCritRule(rule),
    }))
}
console.log("effect.scope =", fioni.combatBuffs.corePassive.scope)
console.log("=> 该规则同时满足 isOutOfCombatFormulaRule 与 isInitialMasteryAnomalyCritRule；")
console.log("   normalizeEffect 的 isDeferredInCombatFormula(scope=inCombat) 因此把它放进 dynamicFormulas（calculator-core.js:1163-1166,1490-1517）。")

// ---------- 驱动盘仓库 ----------
const slotMain = {
    1: { stat: "hpFlat", value: 2200 },
    2: { stat: "atkFlat", value: 316 },
    3: { stat: "defFlat", value: 184 },
    4: { stat: "anomalyProficiency", value: 92 },
    5: { stat: "fireDmg", value: 30, mode: "pct" },
    6: { stat: "atkPct", value: 30, mode: "pct" },
}
const subStatPool = ["atkPct", "anomalyProficiency", "penFlat", "atkFlat", "critRate", "critDmg"]
function makeDisc(id, setId, partition, variant) {
    return {
        id, ownerId: "default", setId, setName: setId,
        partition, rarity: "S", level: 15, maxLevel: 15, locked: false, equippedBy: null,
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
        source: { type: "probe", sequence: Number(String(id).replace(/\D/g, "")) || 999 },
    }
}
function makeStore(variants) {
    const driveDiscs = []
    for (const slot of [1, 2, 3, 4, 5, 6]) {
        for (let v = 0; v < variants; v += 1) {
            driveDiscs.push(makeDisc(`f${slot}-${v}`, "phaethons_melody", slot, v))
            driveDiscs.push(makeDisc(`h${slot}-${v}`, "hormone_punk", slot, v + variants))
        }
    }
    return { version: 1, owners: [{ id: "default", label: "默认用户" }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

// ---------- 输入 ----------
const base = fioniOptimizerInput()
function inputWith(overrides = {}) {
    return {
        ...structuredClone(base),
        ...overrides,
        damage: { ...structuredClone(base.damage), ...(overrides.damage ?? {}) },
        combatBuffs: { ...structuredClone(base.combatBuffs), ...(overrides.combatBuffs ?? {}) },
        settings: { ...structuredClone(base.settings), ...(overrides.settings ?? {}) },
    }
}
function panelFor(input, cat = catalog) {
    return createInCombatPanelCalculator(cat, {
        agentId: input.agentId, coreSkillLevel: input.coreSkillLevel, cinemaLevel: input.cinemaLevel,
        potentialLevel: input.potentialLevel, wEngineId: input.wEngineId,
        wEngineModificationLevel: input.wEngineModificationLevel, combatBuffs: input.combatBuffs, damage: input.damage,
    })
}
const attributeEvent = { id: "attribute", kind: "anomaly", settlementType: "attribute", anomalyEffect: "burn", count: 1, stunned: true, critMode: "expected", anomalySource: { actorRef: { agentId: "fioni" } } }
const statIds = ["atkFlat", "atkPct", "anomalyProficiency", "anomalyMastery", "fireDmg", "penRatio"]
const setIds = ["phaethons_melody", "hormone_punk"]
const setIndexById = new Map(setIds.map((id, i) => [id, i]))
const probeValues = statIds.map((s, i) => (s === "anomalyMastery" ? 30 : s === "atkPct" ? 30 : s === "anomalyProficiency" ? 70 : 10 + i))

function describeKernel(label, dense, counts) {
    if (!dense) { console.log(label, "dense target = null"); return }
    const fixed = dense.compileForSetCounts(Int16Array.from(counts))
    console.log(label, JSON.stringify({
        scoreKernel: fixed.scoreKernel,
        releaseIntervalBound: fixed.releaseIntervalBound,
        hasScoreObjectiveScalar: typeof fixed.scoreObjectiveScalar === "function",
        hasScoreCombinedScalar: typeof fixed.scoreCombinedScalar === "function",
        denseScore: Number(dense.scoreDense(Float64Array.from(probeValues), Int16Array.from(counts)).finalDamage.toFixed(6)),
        fixedScore: Number(fixed.scoreScalar(Float64Array.from(probeValues)).finalDamage.toFixed(6)),
    }))
}

// ---------- 变体 A：原始（release + 核心被动动态公式） ----------
console.log("\n=== 1) 变体 A：原始 release 事件（核心被动动态公式启用） ===")
const inputA = inputWith()
const calculatorA = panelFor(inputA)
const metadataA = calculatorA.optimizerStatMetadata()
console.log("optimizerStatMetadata =", JSON.stringify(metadataA))
const denseA = calculatorA.compileDensePanelScoreTarget({ statIds, setIds, setIndexById })
console.log("densePanelScoreTarget != null:", Boolean(denseA))
for (const counts of [[4, 2], [0, 6], [6, 0]]) describeKernel(`compileForSetCounts([${counts}])`, denseA, counts)

// ---------- 变体 A-attr：改成属性异常（无 release） ----------
console.log("\n=== 2) 变体 A-attr：同一 Buff、事件改为属性异常（无 release） ===")
const inputAttr = inputWith({ damage: { events: [attributeEvent] } })
const calculatorAttr = panelFor(inputAttr)
const metadataAttr = calculatorAttr.optimizerStatMetadata()
console.log("optimizerStatMetadata =", JSON.stringify(metadataAttr))
const denseAttr = calculatorAttr.compileDensePanelScoreTarget({ statIds, setIds, setIndexById })
describeKernel("compileForSetCounts([4,2])", denseAttr, [4, 2])

// ---------- 变体 B：内存目录只移除暴击公式规则（隔离根因） ----------
console.log("\n=== 3) 变体 B：内存目录仅移除 corePassive 的 fioni-sear-crit-rate-attribute 规则 ===")
const patchedAgent = structuredClone(fioni)
patchedAgent.combatBuffs.corePassive.effects = patchedAgent.combatBuffs.corePassive.effects
    .filter(rule => rule.id !== "fioni-sear-crit-rate-attribute")
const patchedCatalog = {
    ...catalog,
    agents: catalog.agents.map(a => (a.id === "fioni" ? patchedAgent : a)),
    agentsMap: new Map([...catalog.agentsMap.entries()].map(([id, a]) => [id, id === "fioni" ? patchedAgent : a])),
}
const calculatorB = panelFor(inputA, patchedCatalog)
const metadataB = calculatorB.optimizerStatMetadata()
console.log("optimizerStatMetadata =", JSON.stringify(metadataB))
const denseB = calculatorB.compileDensePanelScoreTarget({ statIds, setIds, setIndexById })
describeKernel("compileForSetCounts([4,2])", denseB, [4, 2])
let maxDiffB = 0
for (let i = 0; i < 24; i += 1) {
    const values = statIds.map((s, k) => 3 + ((i * 7 + k * 5) % 29))
    const denseScore = denseB.scoreDense(Float64Array.from(values), Int16Array.from([4, 2])).finalDamage
    const fixedScore = denseB.compileForSetCounts(Int16Array.from([4, 2])).scoreScalar(Float64Array.from(values)).finalDamage
    maxDiffB = Math.max(maxDiffB, Math.abs(denseScore - fixedScore))
}
console.log("变体 B：fixed.scoreScalar 与 dense.scoreDense 24 组随机词条最大绝对差 =", maxDiffB)

// ---------- 变体 B2：关闭整个核心被动（对照） ----------
console.log("\n=== 4) 变体 B2：关闭核心被动 Buff（对照） ===")
const inputB2 = inputWith({ combatBuffs: { activeBuffIds: base.combatBuffs.activeBuffIds.filter(id => id !== "agent:fioni.corePassive") } })
const calculatorB2 = panelFor(inputB2, patchedCatalog)
const metadataB2 = calculatorB2.optimizerStatMetadata()
console.log("optimizerStatMetadata =", JSON.stringify(metadataB2))
const denseB2 = calculatorB2.compileDensePanelScoreTarget({ statIds, setIds, setIndexById })
describeKernel("compileForSetCounts([4,2])", denseB2, [4, 2])

// ---------- 动态公式对实际评分的影响（证明内核不能简单忽略它） ----------
console.log("\n=== 5) 动态公式的实际作用：release 事件异常暴击率/伤害 ===")
for (const [label, input, cat] of [["A 原始", inputA, catalog], ["B 移除规则", inputA, patchedCatalog], ["B2 关闭核心被动", inputB2, patchedCatalog]]) {
    const calculator = panelFor(input, cat)
    const out = calculator.calculate([{ setId: "none", mainStat: { stat: "anomalyMasteryFlat", value: 88 } }], { round: false })
    console.log(JSON.stringify({
        label,
        anomalyMastery_outOfCombat: out.outOfCombat?.panel?.anomalyMastery,
        anomalyCritRate: out.damage?.multipliers?.anomalyCritRate,
        anomalyCritDmg: out.damage?.multipliers?.anomalyCritDmg,
        finalDamage: out.damage?.totalFinalDamage,
        dynamicFormulaResults: out.inCombat?.dynamicFormulaResults?.map(r => ({ stat: r.stat, value: r.value, targetKind: r.target?.kind })) ?? null,
    }))
}

// ---------- 优化器指标对比 ----------
console.log("\n=== 6) 优化器 exact-super-bound 指标对比（每号位 6 张候选） ===")
const store = makeStore(3)
const optimizerRows = []
for (const [label, input, cat] of [
    ["A 原始（动态公式 + release）", inputA, catalog],
    ["A-attr 原始 Buff + 属性异常事件", inputAttr, catalog],
    ["B 内存移除暴击公式规则 + release", inputA, patchedCatalog],
    ["B2 关闭核心被动 + release", inputB2, patchedCatalog],
]) {
    const started = performance.now()
    const result = optimizeDriveDiscs(cat, store, input)
    const elapsed = Math.round(performance.now() - started)
    const m = result.metrics ?? {}
    optimizerRows.push({
        label, elapsedMs: elapsed,
        estimated: m.estimatedCombinationCount, evaluated: m.evaluated, scored: m.scoredCombinationCount,
        prunedBySuperBound: m.prunedBySuperBound, prunedByChunkBound: m.prunedByChunkBound,
        prunedBySuffixTopK: m.prunedBySuffixTopKBound, superBoundChecks: m.superBoundChecks,
        scoreKernel: m.scoreKernel, specializedScoreCalls: m.specializedScoreCalls,
        objectiveScalarCalls: m.objectiveScalarCalls, objectiveScalarFallbacks: m.objectiveScalarFallbacks,
        objectiveScalarFallbackReason: m.objectiveScalarFallbackReason,
        relevantStatCount: m.relevantStatCount, evaluatedPerSecond: m.evaluationsPerSecond,
        top1: result.results?.[0]?.score,
    })
}
console.log(JSON.stringify(optimizerRows, null, 2))

// ---------- 全角色扫描 ----------
console.log("\n=== 7) 全角色扫描：带 deferred 动态公式的角色 ===")
function collectRuleKinds(agent) {
    const rules = []
    const visitRules = (holder, label) => {
        if (!holder || typeof holder !== "object") return
        if (Array.isArray(holder.effects)) {
            for (const rule of holder.effects) {
                if (!rule || typeof rule !== "object") continue
                const kind = isInCombatFormulaRule(rule) ? "inCombatFormula"
                    : isOutOfCombatFormulaRule(rule)
                        ? (isInitialMasteryAnomalyCritRule(rule) ? "initialMasteryAnomalyCrit(deferred)" : "outOfCombatFormula(initial/other)")
                        : null
                if (kind) rules.push({ label, id: rule.id, kind, stat: rule.stat, sourceStat: rule.source?.stat })
            }
        }
    }
    const visit = (value, label) => {
        if (!value || typeof value !== "object") return
        if (Array.isArray(value)) { value.forEach((v, i) => visit(v, `${label}[${i}]`)); return }
        visitRules(value, label)
        for (const [key, child] of Object.entries(value)) {
            if (key === "effects") continue
            if (child && typeof child === "object") visit(child, `${label}.${key}`)
        }
    }
    visit(agent.combatBuffs ?? {}, "combatBuffs")
    return rules
}
const scan = []
for (const agent of catalog.agents) {
    const rules = collectRuleKinds(agent)
    if (!rules.length) continue
    scan.push({
        agentId: agent.id,
        releaseInDefault: (agent.defaultCalculationConfig?.events ?? []).some(e => e.settlementType === "release"),
        releaseProfileCount: (agent.anomalyReleaseProfiles ?? []).length,
        rules,
    })
}
console.log(JSON.stringify(scan, null, 2))

// ---------- 代表角色的 release 配置对照 ----------
console.log("\n=== 8) 代表角色 release 配置与区间上界支持方式 ===")
for (const agentId of ["fioni", "aria", "vivian", "velina"]) {
    const agent = catalog.agentsMap.get(agentId)
    if (!agent) continue
    console.log(JSON.stringify({
        agentId,
        defaultEvents: (agent.defaultCalculationConfig?.events ?? []).map(e => ({
            kind: e.kind, settlementType: e.settlementType ?? null, anomalyEffect: e.anomalyEffect ?? null,
        })),
        releaseProfiles: (agent.anomalyReleaseProfiles ?? []).map(p => ({
            id: p.id,
            resultMode: p.resultMode,
            hasCritRateBonusExpression: Boolean(p.critRateBonusExpression),
            expressionNodeKinds: JSON.stringify(p.expression?.op ?? p.expression?.kind ?? null),
        })),
        formulaRules: collectRuleKinds(agent),
    }))
}
