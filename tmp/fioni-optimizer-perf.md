# 菲欧妮驱动盘优化器性能实测报告（剪枝失效量化）

测试日期：2026-10-24；仓库：`E:\yan1\zzz\zzz_calculator`，分支 `codex/fioni-modeling`（未提交/未修改源码与 data/）。
测试机：AMD Ryzen 5 5600G（6 核 12 线程），Node v20.12.2 x64 Windows。
说明：测试期间机器上有其他队友脚本与桌面进程（总 CPU 占用约 80%~95%），所有计时均为**中位数**（能跑多次的用例取 3 次中位，真实库存长跑取单次），并以**确定性指标**（预估组合数、实际评估数、剪枝计数、评分调用数）为主要证据。

---

## 1. 结论（TL;DR）

1. **菲欧妮的"精准优化"完全退化为全组合枚举**：真实库存推荐配置预估 **283,708** 组合，`evaluated=283,708`、`prunedBySuperBound=0`、`superBoundChecks=0`，即评估率 100%、剪枝率 0%。实测单线程 Node 全跑完 **186.7 秒（3.1 分钟）**，吞吐 **1,519 次评估/秒**，其中 93% 的耗时花在叶子评分（`scoreOnlyMs=173,762ms`，`denseScoreMs` 仅 95ms）。
2. **根因不是候选太多，而是上界被静默禁用**：菲欧妮默认输出是"异放（release）"事件，优化器因此要求"异放区间上界"（`requiresReleaseIntervalBound=true`）；但菲欧妮核心被动里有一条 `type:"formula"` 的局内公式（初始异常掌控 → 灼蚀异常暴击率），它使"固定套装目标内核"无法编译，回退到 **`compiled-dense-fixed-sets` 内核且 `releaseIntervalBound=false`**。后者在 `superBoundScoreDense` 里对每次上界检查直接返回 `+Infinity`，于是所有剪枝尝试都被浪费，且公开指标里连 `superBoundChecks` 都不增加——表面看是"0 检查、0 剪枝"，实际每次都在算完上界后放弃（见 §4 的插桩计数）。
3. **对照角色同组合规模下剪枝正常**：同样 960 组合，维琳娜只评估 12 个（剪枝 948，144 次上界检查，175ms），叶瞬光直伤只评估 11 个（剪枝 949，74ms）；同样 10,935 组合，维琳娜评估 10 个（159ms）、叶瞬光评估 18 个（121ms），而菲欧妮评估 10,935 个（6,972ms，约 **44~58 倍**）。菲欧妮在 10,935 组合时比"明确关闭剪枝"的 `exact-legacy`（6,267ms）还慢约 11%。
4. **真实库存上的"上界可用"对照实验**（同一 283,708 组合）：去掉核心被动公式后 **459.6ms**（评估 12 个，剪枝 283,696，**406 倍**提速）；把异放换成属性异常（属性异常不要求异放区间上界）**6,496ms**（29 倍）；换成直伤 **6,317ms**（30 倍）、`exact-super-bound-parallel`（2 worker）**145.6s**（仅 1.3 倍）。
5. 正确性未受影响：960 与 10,935 组合下 `exact-super-bound` 与 `exact-legacy` 的 Top10 盘 ID/分数**完全一致**（表 B）。这是纯性能退化。

---

## 2. 复现命令与脚本

全部脚本只写 `tmp/`，不修改源码与 `data/`；真实库存只读 `data/user_drive_discs.json`。

```pwsh
# 主基准：合成仓库 960 / 10,935 组合，三角色 × 多算法，含中位数计时（约 1 分钟）
node tmp/fioni-perf.mjs                       # 等同于 PERF_CASES=matrix

# 真实库存（推荐配置 自由蓝调4 + 幻夜旋律2，283,708 组合）
PERF_CASES=real-partial node tmp/fioni-perf.mjs     # 3×6s 取消采样，取吞吐中位数（约 20s）
PERF_CASES=real-full node tmp/fioni-perf.mjs        # 完整跑一次，得到真实耗时（本机约 187s）
PERF_CASES=real-variants node tmp/fioni-perf.mjs    # 去公式 / 属性异常 / 直伤 全量对照（约 14s）
PERF_CASES=real-parallel node tmp/fioni-perf.mjs    # exact-super-bound-parallel 全量（本机约 146s）
PERF_CASES=real-alt-sets node tmp/fioni-perf.mjs    # 换成 幻夜旋律4 + 激素朋克2（45,312 组合，约 24s）

# 根因插桩（用 node:module loader 在内存里给 core/driveDiscOptimizer-core.js 加计数器，不改文件）
node --import ./tmp/fioni-engine-instrument-register.mjs tmp/fioni-engine-diag.mjs
node --import ./tmp/fioni-engine-instrument-register.mjs tmp/fioni-engine-real-partial.mjs
node tmp/_fioni-kernel-diag.mjs                # 直接调用公开 API 打印内核能力（releaseIntervalBound 等）

# 由原始数据生成报告表格
node tmp/fioni-perf-analysis.mjs               # 读 tmp/fioni-perf-raw.json → tmp/fioni-perf-tables.md
```

关键文件：

| 文件 | 作用 |
| --- | --- |
| `tmp/fioni-perf.mjs` | 主性能脚本（矩阵 / 真实库存 / 变体 / 并行 / 换套装），结果写 `tmp/fioni-perf-raw.json` |
| `tmp/fioni-perf-analysis.mjs` | 从 `tmp/fioni-perf-raw.json` 生成表格 `tmp/fioni-perf-tables.md` |
| `tmp/fioni-engine-instrument-loader.mjs` + `-register.mjs` | 只读插桩：在内存中 patch 优化器内核，统计"上界返回 +∞"的次数（仓库文件零改动） |
| `tmp/fioni-engine-diag.mjs` | 合成仓库 960 组合的四组对照（release+公式 / 去公式 / 属性异常 / 维琳娜） |
| `tmp/fioni-engine-real-partial.mjs` | 真实库存 283,708 组合的插桩证据（6s 取消 + 去公式全量） |
| `tmp/fioni-engine-real-partial.out.txt`、`tmp/fioni-engine-diag.out.txt`、`tmp/fioni-kernel-diag.out.txt` | 插桩/内核实测输出存档 |
| `tmp/fioni-perf-raw.json` | 全部原始 metrics（可复查，无需重跑长实验） |

---

## 3. 根因链路（代码位置）

1. 默认伤害事件是异放（release）：`data/agents.json` 中 `fioni.defaultCalculationConfig` = 单次焚罪异放；`core/calculator-core.js:8688` `hasReleaseFormula = events.some(event => event.isRelease)`，写入 `optimizerStatMetadata.requiresReleaseIntervalBound = true`（`:8693`）。
2. 菲欧妮核心被动含一条局内公式规则（`data/agents.json` → `fioni.combatBuffs.corePassive.effects[1]`，`type:"formula"`，`source.stat=anomalyMastery`，表达式 `clamp(30 + max(x-155,0)*0.7, 0, 100)`）→ 编译目标时进入 `dynamicFormulaEntries`。
3. `core/calculator-core.js:9412-9421`：`compileFixedNonDirectObjectiveKernel()` 只要 `dynamicFormulaEntries.length > 0` 就直接 `return null`。因此能提供异放区间上界的"固定套装目标内核"不存在。
4. `core/calculator-core.js:9909-9916`：回退到 `compiled-dense-fixed-sets` 内核，`releaseIntervalBound: fixedObjectiveKernel?.releaseIntervalBound === true` → **false**，且没有 `scoreObjectiveScalar/scoreCombinedScalar`（实测 `objectiveScalarFallbacks=1, reason="unsupported-objective"`）。
5. `core/driveDiscOptimizer-core.js:2543-2546`（`superBoundScoreDense`）：`requiresReleaseIntervalBound && releaseIntervalBound !== true` 时**直接返回 `+Infinity`，且这次判断在 `superBoundChecks += 1` 之前**。所以对外指标里是 `superBoundChecks=0`、`boundCheckMs=0`、`safeBoundFallbacks=0`——悄无声息地放弃，连"回退"计数都没有。
6. 结果：`checkSuperBoundPrune`（`:2909`）每次都拿到不可用的上界，`prunedBySuperBound` 永远为 0，枚举按完整笛卡尔积跑完。另一次要损失：`strictMonotonic` 也因公式而为 false（`:8690`），`relevantStatCount=0`，目标相关词条支配/后缀前沿同样不生效。
7. 叶子评分还有一层叠加因素：`exact-super-bound` 算法下选中盘评分走 `scoreSelectedDiscsInSlotOrder` → `scoreOnlyFromMaps` 的 **Map 路径**（`core/driveDiscOptimizer-core.js:2506-2509`），而不是 dense kernel。所以全枚举时 `scoreOnlyMs` 占绝对大头（真实库存 173.8s / 186.7s = 93.1%），`denseScoreCalls` 只有 512 次（seed/探测），`denseScoreMs=95ms`。剪枝生效时叶子很少，这一层不构成问题；剪枝失效时它把每次全量评估的成本放大到约 0.5–0.66ms。

---

## 4. 证据一：引擎级插桩（直接证明"上界被 +∞ 短路"）

用 `node:module` loader 在内存中给 `superBoundScoreDense` 的 early-return、`checkSuperBoundPrune`、内核编译点加计数器（**不修改仓库文件**）。原始输出见 `tmp/fioni-engine-diag.out.txt`、`tmp/fioni-engine-real-partial.out.txt`。

| 场景 | 预估组合 | 实际评估 | 剪枝数 | 公开 `superBoundChecks` | 插桩 `pruneCalls`（cutoff 有限） | 插桩 `boundInfinityReleaseInterval` | 耗时 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 合成仓库 c=2（release+核心被动） | 960 | 960 | 0 | 0 | 2,835 | **2,835（100%）** | 1,562 |
| 真实库存 6s 采样（release+核心被动） | 283,708 | 12,371（6s 内） | 0 | 0 | 18,725 | **18,725（100%）** | 6,001 |
| 真实库存去核心被动公式（release 保留） | 283,708 | 12 | 283,696 | 3,116 | 3,116 | 0 | 414 |

即：release 路径下**每一次**剪枝尝试（真实库存 6 秒内就有 1.87 万次）都在第 5 步返回 `+Infinity`；去掉公式后同规模 414ms 跑完。

直接调用公开 API 打印内核能力（`tmp/_fioni-kernel-diag.mjs`，输出存档 `tmp/fioni-kernel-diag.out.txt`）：

| 配置 | `requiresReleaseIntervalBound` | `strictMonotonic` | 内核 `scoreKernel` | `releaseIntervalBound` | `scoreObjectiveScalar` |
| --- | --- | --- | --- | --- | --- |
| release + 核心被动公式（当前用户路径） | true | false | `compiled-dense-fixed-sets` | **false** | 无 |
| release + 去掉核心被动 | true | false | `compiled-objective-fixed-sets` | **true** | 有 |
| 属性异常（无 release）+ 核心被动 | **false** | false | `compiled-dense-fixed-sets` | false | 无 |

---

## 5. 证据二：同组合规模三角色对比（确定性指标 + 中位耗时）

表 A（完整表见 `tmp/fioni-perf-tables.md`，原始 metrics 见 `tmp/fioni-perf-raw.json`）：

| 用例 | 预估组合 | 实际评估 | 评估占比 | superBound 剪枝数 | superBound 检查数 | 中位耗时 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| fioni c=2（960） | 960 | 960 | 100.00% | 0 | 0 | 1,491.8 |
| velina c=2（release 对照） | 960 | 12 | 1.25% | 948 | 144 | 175.2 |
| ye_shunguang c=2（直伤对照） | 960 | 11 | 1.15% | 949 | 99 | 74.1 |
| fioni c=3（10,935） | 10,935 | 10,935 | 100.00% | 0 | 0 | 6,972.0 |
| velina c=3 | 10,935 | 10 | 0.09% | 10,925 | 416 | 159.0 |
| ye_shunguang c=3 | 10,935 | 18 | 0.16% | 10,917 | 880 | 121.2 |
| **fioni `exact-legacy` c=3** | 10,935 | 10,935 | 100.00% | 0 | 0 | **6,267.2** |
| fioni `exact-super-bound-parallel` c=3 | 10,935 | 10,935 | 100.00% | 0 | 0 | 4,846.4 |

要点：
- 剪枝失效是**菲欧妮特有**（同样 release 结算的维琳娜剪枝 99.9%），因此不是"异放目标就一定慢"，而是"菲欧妮的上界内核不可用"。
- 默认 `exact-super-bound` 在剪枝失效时比 `exact-legacy`（关闭剪枝）还慢约 11%，用户换算法并不能解决。
- `exact-super-bound-parallel`（2 worker）在 10,935 组合上只有 1.44 倍加速；真实库存 283,708 组合 145.6s vs 186.7s，仅 **1.28 倍**（worker 启动 + 任务切分 + 机器后台负载）。
- 表 B：c=2/c=3 下 super-bound 与 legacy 的 Top10 盘 ID 与分数完全一致 → 慢**不影响正确性**。

---

## 6. 真实库存（283,708 组合）的实测耗时

数据：`data/user_drive_discs.json`，451 张盘，全部属于 owner `default`。菲欧妮角色推荐：4 件套 `freedom_blues`（库存 38 张）+ 2 件套 `phaethons_melody`（36 张），主词条限制 `4:anomalyProficiency/atkPct, 5:fireDmg/atkPct/penRatio, 6:anomalyMastery/atkPct`。

| 指标 | 实测值 |
| --- | ---: |
| 每槽候选数（1~6 号位） | 11 / 19 / 11 / 7 / 9 / 8 |
| `estimatedCombinationCount` | **283,708**（15 个 4+2 枚举计划） |
| `evaluated` / `scoredCombinationCount` | 283,708 / 283,708（100%） |
| `prunedBySuperBound` / `superBoundChecks` | 0 / 0 |
| 完整耗时（单线程 Node，中位=单次） | **186,725.6 ms ≈ 3.11 分钟** |
| `evaluationsPerSecond`（进程内计时） | 1,519 /s |
| `scoreOnlyMs`（叶子 Map 评分） | 173,762.2 ms（93.1%） |
| `denseScoreMs` / `denseScoreCalls` | 95 ms / 512 次 |
| `boundCheckMs` / `fullResultMs` / `preparationMs` | 0 / 48.9 / 143.9 ms |
| `scoreKernel` / `objectiveScalarFallbacks` | `compiled-dense` / 1（`unsupported-objective`） |
| 并行 `exact-super-bound-parallel`（2 worker） | 145,594.1 ms（1.28×） |
| 换套装（幻夜旋律 4 + 激素朋克 2） | 45,312 组合 → **23,768.5 ms（23.8s）**，0.525 ms/组合 |

用户可感知耗时：**当前默认配置约 3 分钟（本机 150~190s 区间，取决于机器负载；移除剪枝后的浏览器/Worker 路径只会更慢）**。中间 6s 采样显示 6s 只完成 4.21%，外推 ≈142s，与完整实测 187s 一致（差异为负载波动）。

---

## 7. 不同候选规模 → 组合数 → 预计耗时

模型：固定 4 件套 + 固定 2 件套、套装不重叠时，枚举计划数 = C(6,4)=15，组合数 = **15 × c⁶**（c = *每套每槽*候选数；每槽总候选 = 2c）。真实库存推荐配置相当于 c≈5.16。

实测锚点（单线程 Node，含准备开销）：10,935 → 6,972ms（0.638ms/组合）；45,312 → 23,768ms（0.525）；283,708 → 186,726ms（0.658）。取保守 **0.658 ms/组合**做外推：

| 每套每槽 c | 每槽总候选 2c | 组合数 | 预计耗时（单线程 Node） |
| ---: | ---: | ---: | ---: |
| 2 | 4 | 960 | 1.1 s（实测中位 1.5s，含固定准备开销） |
| 3 | 6 | 10,935 | 7.7 s（实测 7.0s） |
| 4 | 8 | 61,440 | 40.9 s |
| 5 | 10 | 234,375 | 2.6 min |
| 6 | 12 | 699,840 | 7.7 min |
| 7 | 14 | 1,764,735 | 19.4 min |
| 8 | 16 | 3,932,160 | 43.1 min |
| 10 | 20 | 15,000,000 | 2.7 h |
| 15 | 30 | 170,859,375 | 31.2 h |
| 20 | 40 | 960,000,000 | 175.5 h |
| 30 | 60 | 10,935,000,000 | 1998.7 h |

解读：
- **库存稍多就爆炸**：每槽 10 个候选已是 2.6 分钟，每槽 20 个候选就是 2.7 小时——这是组合爆炸 × 0 剪枝的直接结果，与用户"非常慢"的报告一致。
- 若用户改用"幻夜旋律 4 + 激素朋克 2"（真实库存另一套组合）：45,312 组合，实测 **23.8s**，仍属"明显慢"。
- 表中外推为单线程 Node；浏览器 Worker 串行路径的绝对耗时可再上浮（本次未测浏览器真实耗时），但剪枝计数与组合数是一致的确定性指标，不受客户端影响。

---

## 8. 如果上界生效：预期收益（真实库存同 283,708 组合对照）

| 变体 | 实际评估 | 剪枝数 | superBound 检查数 | 耗时 | 相对当前 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 当前（release + 核心被动公式） | 283,708 | 0 | 0 | 186,725.6 ms | 1.0× |
| 仅并行（2 worker，剪枝仍失效） | 283,708 | 0 | 0 | 145,594.1 ms | 1.3× |
| release + 去掉核心被动公式 | 12 | 283,696 | 3,116 | **459.6 ms** | **406×** |
| 属性异常（不要异放区间上界） | 11 | 283,697 | 3,730 | 6,496.1 ms | 28.7× |
| 直伤 | 173 | 283,535 | 5,745 | 6,316.6 ms | 29.6× |

- 最好情形（`compiled-objective-fixed-sets` 内核 + `releaseIntervalBound=true` + `scoreCombinedScalar`）：**0.46s**，与维琳娜/叶瞬光的量级一致，即 **400 倍级**提速。
- 即使只恢复"通用/较贵"的逐支上界（`compiled-dense-fixed-sets` 的 `scoreScalar` 每次重算，属性异常变体即为该情形）：约 **6.3~6.5s**，仍有 **29 倍级**提速。
- 结论：**修复方向应是让异放目标能拿到可证明上界**（例如让固定套装目标内核支持该"初始异常掌控→暴击率"的钳位/单调公式，或为该公式提供区间上界），而不是继续加 worker 或在 UI 上做文章。叶子评分改走 dense kernel 是第二层优化（当前 93% 时间在 Map 叶子评分），但在剪枝恢复后其收益远小于恢复剪枝。

---

## 9. 边界与未覆盖

- 全程未修改仓库源码、`data/` 或用户库存；只在 `tmp/` 写脚本与结果；插桩通过 `node:module` loader 在内存完成（`node --import`），不落盘改文件。
- 计时受同机其他进程/队友脚本影响（CPU 80%~95%），已用中位数与确定性指标缓解；绝对耗时会随机器负载浮动，量级与比例稳定。真实库存长跑各只做了一次（187s / 146s / 24s），合成用例做了 2~3 次取中位。
- 未实测浏览器端真实耗时与取消/进度表现（任务 1 的"性能量化"以 Node 优化器内核为准）；未跑 fuzz/全量测试。正确性只对 c=2/c=3 的 Top10 一致性与去公式对照做了抽查。
- `node --import` 插桩只作用于单线程串行路径（`real_current_full` 本就因 283,708 < 2,000,000 阈值而串行）；并行路径的 `superBoundChecks=0`/`pruned=0` 来自公开 metrics 实测。

---

## 10. 原始数据索引

- `tmp/fioni-perf-raw.json`：所有用例的完整 metrics、Top10、每次计时的 elapsed、校准值。
- `tmp/fioni-perf-tables.md`：由 raw 生成的表 A~E。
- `tmp/fioni-engine-diag.out.txt` / `tmp/fioni-engine-real-partial.out.txt` / `tmp/fioni-kernel-diag.out.txt`：插桩与内核能力原始输出。
- `tmp/fioni-perf.mjs` / `tmp/fioni-perf-analysis.mjs` / `tmp/fioni-engine-*.mjs`：可复现脚本（命令见 §2）。
