// 叶子评分路径微基准：对比 map / indexed / dense / fixed-dense-fallback 四条路径。
// 对应 driveDiscOptimizer-core.js:2506-2517 selectedScoreOnlySummary 在 super-bound 算法下
// 强制走 scoreSelectedDiscsInSlotOrder → scoreOnlyFromMaps。
import { loadCalculatorContext, createInCombatPanelCalculator, calculateInCombatPanel } from "../backend/calculator.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"

const cat = await loadCalculatorContext(process.cwd())
const base = fioniOptimizerInput()
const input = {
    agentId: "fioni", coreSkillLevel: base.coreSkillLevel, cinemaLevel: base.cinemaLevel,
    wEngineId: base.wEngineId, wEngineModificationLevel: base.wEngineModificationLevel,
    combatBuffs: base.combatBuffs, damage: base.damage,
}
const p = createInCombatPanelCalculator(cat, input)
const statIds = ["atkFlat", "atkPct", "anomalyProficiency", "anomalyMastery", "fireDmg", "penRatio", "dmgBonus"]
const values = statIds.map((s, i) => 10 + i * 5)
const summary = new Map(statIds.map((s, i) => [s, values[i]]))
const sets = new Map([["phaethons_melody", 4], ["hormone_punk", 2]])
const setIds = ["phaethons_melody", "hormone_punk"]
const setIndexById = new Map(setIds.map((id, i) => [id, i]))
const dense = p.compileDensePanelScoreTarget({ statIds, setIds, setIndexById })
const fixed = dense.compileForSetCounts(Int16Array.from([4, 2]))
function bench(label, fn, n) {
    for (let i = 0; i < 100; i += 1) fn()
    const started = performance.now()
    for (let i = 0; i < n; i += 1) fn()
    const micros = ((performance.now() - started) / n) * 1000
    console.log(`${label}: ${micros.toFixed(2)} us/call`)
}
console.log("fioni release 叶子评分路径微基准（同一组面板/词条）")
bench("map scoreOnlyFromSummary", () => p.scoreOnlyFromSummary(summary, sets), 3000)
bench("indexed scoreOnlyFromIndexedSummary", () => p.scoreOnlyFromIndexedSummary(Float64Array.from(values), statIds, Int16Array.from([4, 2]), setIds, setIndexById), 3000)
bench("dense scoreDense", () => dense.scoreDense(Float64Array.from(values), Int16Array.from([4, 2])), 3000)
bench("fixed-dense-fallback scoreScalar", () => fixed.scoreScalar(Float64Array.from(values)), 3000)
bench("calculate full", () => calculateInCombatPanel(cat, { ...input, driveDiscs: [] }), 1000)
