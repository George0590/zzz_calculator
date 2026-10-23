// Turns tmp/fioni-perf-raw.json into the tables used by tmp/fioni-optimizer-perf.md.
// Also previews the real inventory with the recommended (freedom_blues + phaethons_melody)
// and the alternative (phaethons_melody + hormone_punk) set configuration.
// Run: node tmp/fioni-perf-analysis.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadCalculatorContext } from "../backend/calculator.js"
import { createDriveDiscOptimizerRuntime } from "../core/driveDiscOptimizer-core.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const raw = JSON.parse(fs.readFileSync(path.join(rootDir, "tmp", "fioni-perf-raw.json"), "utf8"))
const byLabel = new Map(raw.cases.map(item => [item.label, item]))
const catalog = await loadCalculatorContext(rootDir)
const realStore = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "user_drive_discs.json"), "utf8"))
const agent = catalog.agentsMap?.get("fioni")
const preferred = agent?.preferredDriveDiscs ?? {}
const runtime = createDriveDiscOptimizerRuntime({ yieldControl: () => new Promise(resolve => setImmediate(resolve)) })

const lines = []
const say = text => { lines.push(text); console.log(text) }
const fmt = (value, digits = 1) => Number(value).toFixed(digits)
const pct = value => `${fmt(Number(value) * 100, 2)}%`

// ---------------------------------------------------------------- 1. pruning table
say("## 表 A：同组合规模下菲欧妮与对照角色的剪枝/评估对比（确定性指标 + 中位耗时）")
say("")
say("| 用例 | 预估组合 | 实际评估 | 评估占比 | superBound 剪枝数 | superBound 检查数 | 中位耗时 ms |")
say("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
for (const label of [
    "fioni_sb_c2", "velina_sb_c2", "ye_shunguang_sb_c2",
    "fioni_sb_c3", "velina_sb_c3", "ye_shunguang_sb_c3",
    "fioni_legacy_c3", "fioni_parallel_c3",
    "fioni_fixture_64",
    "real_current_full", "real_alt_sets_full", "real_parallel_default_workers", "real_noCoreFormula_full", "real_attribute_full", "real_direct_full",
]) {
    const item = byLabel.get(label)
    if (!item) continue
    const m = item.metrics ?? {}
    const estimated = Number(m.estimatedCombinationCount ?? 0)
    const evaluated = Number(m.evaluated ?? 0)
    say(`| ${label} | ${estimated} | ${evaluated} | ${pct(estimated ? evaluated / estimated : 0)} | ${m.prunedBySuperBound ?? 0} | ${m.superBoundChecks ?? 0} | ${fmt(item.elapsedMsMedian ?? 0)} |`)
}
say("")

// -------------------------------------------------- 2. top10 equality sb vs legacy
function sameTop10(leftLabel, rightLabel) {
    const left = byLabel.get(leftLabel)?.topResults ?? []
    const right = byLabel.get(rightLabel)?.topResults ?? []
    return left.length === right.length && JSON.stringify(left) === JSON.stringify(right)
}
say("## 表 B：正确性（剪枝失效不影响结果）")
say("")
say(`- fioni c=2：exact-super-bound Top10 与 exact-legacy Top10 完全一致 = ${sameTop10("fioni_sb_c2", "fioni_legacy_c2")}`)
say(`- fioni c=3：exact-super-bound Top10 与 exact-legacy Top10 完全一致 = ${sameTop10("fioni_sb_c3", "fioni_legacy_c3")}`)
say("")

// ----------------------------------------- 3. real inventory preview for two set configs
function realInputForSets({ fourPieceSetIds, twoPieceSetIds, mainStatLimits }) {
    const base = fioniOptimizerInput()
    const defaultConfig = agent?.defaultCalculationConfig ?? {}
    return {
        ...base,
        damage: {
            ...base.damage,
            events: (defaultConfig.events ?? base.damage.events).map(event => structuredClone(event)),
            selectedEventId: defaultConfig.events?.[0]?.id ?? base.damage.selectedEventId,
            skillLevelsByCategory: defaultConfig.skillLevelsByCategory ?? base.damage.skillLevelsByCategory,
        },
        combatBuffs: {
            ...base.combatBuffs,
            // four-piece active Buff id is injected by the optimizer from fourPieceSetIds
            activeBuffIds: [
                "agent:fioni.corePassive",
                "agent:fioni.additionalAbility",
                "agent:fioni.skill.release_crit_dmg",
            ],
        },
        settings: {
            ...base.settings,
            fourPieceSetIds,
            twoPieceSetIds,
            mainStatLimits,
            algorithm: "exact-super-bound",
        },
    }
}

function previewOf(input) {
    const started = performance.now()
    const job = runtime.createJob(catalog, realStore, input, {})
    const preview = job.preview()
    return { preview, prepMs: performance.now() - started }
}

const scenarios = [
    {
        label: "角色推荐：自由蓝调 4 + 幻夜旋律 2",
        fourPieceSetIds: preferred.defaultSetIds ?? [],
        twoPieceSetIds: preferred.defaultTwoPieceSetIds ?? [],
        mainStatLimits: preferred.mainStatLimits ?? {},
    },
    {
        label: "改用：幻夜旋律 4 + 激素朋克 2",
        fourPieceSetIds: ["phaethons_melody"],
        twoPieceSetIds: ["hormone_punk"],
        mainStatLimits: preferred.mainStatLimits ?? {},
    },
]
const inventoryCounts = {}
for (const disc of realStore.driveDiscs ?? []) inventoryCounts[disc.setId] = (inventoryCounts[disc.setId] ?? 0) + 1
say("## 表 C：真实库存（data/user_drive_discs.json，451 张）两种套装配置的预估组合数")
say("")
say(`- 库存相关套数：freedom_blues=${inventoryCounts.freedom_blues ?? 0}，phaethons_melody=${inventoryCounts.phaethons_melody ?? 0}，hormone_punk=${inventoryCounts.hormone_punk ?? 0}`)
say("")
say("| 配置 | 每槽候选数 | 预估组合 | 准备耗时 ms |")
say("| --- | --- | ---: | ---: |")
const MS_PER_COMBO = 0.658 // 实测：real_current_full 186725.6ms / 283708 组合
const scenarioResults = []
for (const scenario of scenarios) {
    const { preview, prepMs } = previewOf(realInputForSets(scenario))
    const metrics = preview.metrics ?? {}
    const estimated = Number(metrics.estimatedCombinationCount ?? 0)
    scenarioResults.push({ ...scenario, estimated })
    const counts = metrics.candidateCountsBySlot ?? {}
    const perSlot = Object.keys(counts).sort().map(slot => counts[slot]).join("/")
    say(`| ${scenario.label} | ${perSlot} | ${estimated} | ${fmt(prepMs)} |`)
}
say("")

// -------------------------------------------------------- 4. projection table (c^6 model)
say("## 表 D：每套每槽候选数 → 组合数 → 预计耗时（菲欧妮默认 release 路径，剪枝失效）")
say("")
say("模型：固定 4 件套 + 固定 2 件套时组合数 = 15 × c^6（c = 每套每槽候选数，每槽总候选 = 2c）。")
say(`耗时按实测 ${MS_PER_COMBO} ms/组合（真实库存 283708 组合 → 186.7s）线性外推，另加约 0.5s 固定准备开销。`)
say("")
say("| 每套每槽 c | 每槽总候选 2c | 组合数 | 预计耗时（单线程 Node） |")
say("| ---: | ---: | ---: | ---: |")
function human(seconds) {
    if (seconds < 90) return `${fmt(seconds)} s`
    if (seconds < 5400) return `${fmt(seconds / 60)} min`
    return `${fmt(seconds / 3600)} h`
}
for (const c of [2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 30]) {
    const estimated = 15 * c ** 6
    const seconds = estimated * MS_PER_COMBO / 1000 + 0.5
    say(`| ${c} | ${2 * c} | ${estimated.toLocaleString("en-US")} | ${human(seconds)} |`)
}
say("")
say(`- 真实库存推荐配置 = ${scenarioResults[0].estimated.toLocaleString("en-US")} 组合，实测 ${fmt(byLabel.get("real_current_full")?.elapsedMsMedian ?? 0)} ms（≈${fmt((byLabel.get("real_current_full")?.elapsedMsMedian ?? 0) / 1000 / 60)} min），相当于每套每槽约 ${fmt(Math.pow(scenarioResults[0].estimated / 15, 1 / 6), 2)} 个候选。`)
const altItem = byLabel.get("real_alt_sets_full")
if (altItem) {
    say(`- 真实库存换套装（幻夜旋律 4 + 激素朋克 2）= ${scenarioResults[1].estimated.toLocaleString("en-US")} 组合，实测 ${fmt(altItem.elapsedMsMedian)} ms（${fmt(altItem.elapsedMsMedian / 1000)} s，${fmt(altItem.elapsedMsMedian / altItem.metrics.estimatedCombinationCount, 3)} ms/组合），线性表预测 ${human(scenarioResults[1].estimated * MS_PER_COMBO / 1000 + 0.5)}。`)
} else {
    say(`- 真实库存换套装（幻夜旋律 4 + 激素朋克 2）= ${scenarioResults[1].estimated.toLocaleString("en-US")} 组合，预计 ${human(scenarioResults[1].estimated * MS_PER_COMBO / 1000 + 0.5)}。`)
}
const anchors = [
    ["fioni_sb_c3", 10935, 6972.0],
    ["real_alt_sets_full", 45312, 23768.5],
    ["real_current_full", 283708, 186725.6],
]
say("")
say("实测锚点（同一台机器，单线程 Node，CPU 有后台负载）：")
for (const [label, combinations, elapsedMs] of anchors) {
    if (!byLabel.has(label)) continue
    say(`- ${combinations.toLocaleString("en-US")} 组合 → ${fmt(elapsedMs)} ms = ${fmt(elapsedMs / combinations, 3)} ms/组合（${label}）`)
}
say("- 因此外推区间用 0.52–0.66 ms/组合；表 D 采用偏保守的 0.658 ms/组合。")
say("")

// ------------------------------------ 5. recovery variants measured on real inventory
say("## 表 E：真实库存上“上界可用”对照实验（同 283708 组合）")
say("")
say("| 变体 | 实际评估 | 剪枝数 | superBound 检查数 | 耗时 ms | 相对当前提速 |")
say("| --- | ---: | ---: | ---: | ---: | ---: |")
const current = byLabel.get("real_current_full")?.elapsedMsMedian ?? 0
for (const label of ["real_current_full", "real_parallel_default_workers", "real_attribute_full", "real_direct_full", "real_noCoreFormula_full"]) {
    const item = byLabel.get(label)
    if (!item) continue
    const m = item.metrics ?? {}
    say(`| ${label} | ${m.evaluated ?? 0} | ${m.prunedBySuperBound ?? 0} | ${m.superBoundChecks ?? 0} | ${fmt(item.elapsedMsMedian ?? 0)} | ${fmt(current / (item.elapsedMsMedian || 1))}× |`)
}
say("")

fs.writeFileSync(path.join(rootDir, "tmp", "fioni-perf-tables.md"), `${lines.join("\n")}\n`, "utf8")
console.log("\nWROTE tmp/fioni-perf-tables.md")
