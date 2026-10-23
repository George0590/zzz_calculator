# 菲欧妮驱动盘优化：UI / Worker / 默认配置路径核查（task-3）

核查者：ui-path-checker；仓库 `E:\yan1\zzz\zzz_calculator`；HEAD `7f4f3d4`；只读核查，未改动源码/data，脚本与本文均在 `tmp/`。
核心根因（Node 侧严格优化器剪枝被禁用 → 退化为全枚举）由 Lead 已确认，本报告只核查**额外的慢因**、**默认配置放大**、**提交回归**与**覆盖缺口**。

## 0. 结论速览

| 假设 | 结论 | 关键证据 |
| --- | --- | --- |
| 浏览器默认算法/Worker 路径有额外慢因 | **排除（主因不在此）** | 浏览器固定 `exact-super-bound`、单控制 Worker、`disableParallel:true`，与 Node 单线程同一内核；实测差 0~18%（含事件循环让步），且 Node 只有在 ≥2,000,000 组合时才并行 |
| 每次运行重建 catalog / 重复解析大数据 | **排除** | Worker 内缓存 catalog，仅 Worker 生命周期首次传输（catalog 2.2 MB）；成功运行后 Worker 复用；仅取消/错误/卡死或 catalog 重载后重传 |
| 进度上报/取消机制开销 | **确认但很小** | 进度 200 ms（≈5 次/秒）；取消只改状态+terminate；事件循环让步（`setTimeout(0)`，50 ms 间隔）实测约 +3~18%，见 §1.3 |
| Fioni 默认候选空间异常大 | **排除** | 用真实库存 + 默认配置**精确复现 283,708**；同库存下 Fioni 默认候选池（2 个套装）比 Velina（3 个套装）更小。放大来自"异放默认事件命中无剪枝路径"，不是默认空间 |
| 最近提交引入性能回归 / Workers 缓存失效 | **排除** | `git status` 仅 `?? tmp/`；26aa031/a3c0db8/7f4f3d4 均未改动 `core/driveDiscOptimizer-core.js`、`webapp/src/workers/optimizer.worker.ts`、`webapp/src/stores/optimizer.ts`、`OptimizerConfigModal.vue`；剪枝门槛与 `releaseIntervalBound` 契约都早于 Fioni（详见 §3） |
| 测试/基准覆盖缺口 | **确认成立**（比 task 描述更具体） | Fioni 严格优化器用例仅 64 组合、只断言 Top10；Fioni Worker e2e 也是同一 64 组合 fixture；benchmark 无 Fioni/异放场景且无剪枝有效性断言（§4） |
| UI 侧独立问题 | **确认 1 项 UX 问题 + 1 项行为疑点** | 复杂度档位把 283,708 判为"中等"，只在 high/extreme 才给建议（无 ETA/预警）；"清空主词条"对已有角色推荐的角色实际不生效（§2.3） |

## 1. 浏览器/UI 实际走的算法与 Worker 路径

### 1.1 代码路径（GUI 全部本地 Worker，不走 `/api/optimize`）

- 默认算法：`webapp/src/stores/optimizer.ts:529`（state `algorithm: "exact-super-bound"`），`:123-126` 把历史 `exact-super-bound-parallel` 静默迁移为 `exact-super-bound`；对应契约 `docs/regression-contract.md:373`、`:399-400`。
- 单控制 Worker + 复用：`optimizer.ts:54-60`（模块级 `activeWorker`，只建一个），`:62-69` 用 `toRaw` 身份判定是否需要重发 catalog；成功运行后 `finishRun()` 不 terminate（`:860-869`），只有取消/错误/卡死才 `disposeWorker()`（`:863`、`:1020-1035`、`:870-887`）。
- Worker 内：`webapp/src/workers/optimizer.worker.ts:3-5` 用 `yieldControl = setTimeout(0)` 创建浏览器 runtime（**无** `runParallel`），`:20-31` 强制 `algorithm → exact-super-bound` + `disableParallel: true`；`:9-10`、`:41-45` 缓存 catalog；`:111-114` 运行参数 `chunkSize: 5000, progressIntervalMs: 200, yieldIntervalMs: 50`。
- 前端每次只传当前账号库存：`optimizer.ts:498-517`（`optimizerStorePayload` 过滤 owner 后克隆 451 盘），`:997-1007` postMessage。
- UI 算法下拉：`webapp/src/views/WorkbenchView.vue:288-292` 仅"精确搜索（超界剪枝）/启发式潜力/旧版精确"，无并行项；`OptimizerConfigModal.vue:35-39` 同。
- 后端接口存在但页面不用：`backend/server.js:2948-3030`（`/api/optimize/drive-discs/*`），其 job 参数 `backend/server.js:627-650` 为 `chunkSize:10000, progressIntervalMs:250`；Node runtime 有 `runParallel`（`backend/driveDiscOptimizer.js:279`），浏览器 runtime 没有。`webapp/src` 内对 `/api/optimize` 的引用为 **0**。
- 并行阈值：`core/driveDiscOptimizer-core.js:4286`（`parallelThreshold ?? 2,000,000`）——默认 283,708 < 2M，**Node 与浏览器在本次报障场景下都是单线程/串行**；只有放大到 ≥2M（例如清空 2 件套限制，见 §2）Node 才会并行、浏览器仍串行。

### 1.2 一次运行的固定开销（与组合数无关）

| 项 | 数值 | 证据 |
| --- | --- | --- |
| catalog 移交 Worker | JSON 2,215,668 B；深克隆 ~70 ms；structuredClone ~74 ms，**每个 Worker 生命周期一次** | 实测（`tmp/fioni-ui-overhead-probe.mjs`）；`optimizer.ts:62-69` |
| 每次运行的输入克隆 | 仅当前 owner 的 451 盘 + input，毫秒级 | `optimizer.ts:498-517`、`:857` |
| 准备阶段（preview/建状态） | 默认 283,708 场景 **402 ms**；2.35M 场景 429 ms；多 4 件套时每分支各建一次状态 | 实测；`core/driveDiscOptimizer-core.js:4572-4588`、多分支 `:4679-4690` 与 `:4710-4752` |
| 进度上报 | 200 ms 一次（≈5 次/秒，31k 组合约 105-133 条），消息体 metrics 数 KB | `optimizer.worker.ts:111-114`、`optimizer.ts:1004`；实测 |
| 看门狗 | 45 s 无进度才报错；本场景每 200 ms 有进度，不会误杀 | `optimizer.ts:11`、`:880-887` |
| 取消 | 直接置"已取消"并 terminate Worker（下次运行需重发 catalog） | `optimizer.ts:1020-1035`；测试 `optimizer.test.ts:828` 已覆盖"取消后新建 Worker 并重传 catalog" |

### 1.3 事件循环让步的真实开销（本机实测，含噪声）

真实库存 `data/user_drive_discs.json`（451 盘）+ Fioni 默认配置，抽稀到 31,368 个合法组合（完整 283,708 需 150-190 s，两次对照过慢），交错重复 2 轮、取最小值：

| 路径 | 最小耗时 | 组合/秒 |
| --- | --- | --- |
| 同步内核（Node 串行基线） | 18,260 ms | 1,718 |
| 浏览器 runtime 复刻（chunk5000 / progress200 / yield50 + `setTimeout(0)`） | 21,507 ms | 1,459 |
| 同上但 yield 用微任务（无 timer） | 18,704 ms | 1,677 |
| 同上但 `yieldIntervalMs: 1000` | 17,995 ms | 1,743 |
| Node `optimizeDriveDiscsAsync`（Node API 路径） | 19,477 ms（前一轮配对） | ≈1,610 |
| 仪器化单次：488 次 yield、`setTimeout` 累计 4,187 ms | 25,242 ms 墙钟 | 16.6%（本机有团队并行基准争用；每次 yield 5.8-8.6 ms，真实浏览器 Worker 通常 1-4 ms → 预计 **+3~10%**） |

结论：
1. **浏览器 ≈ Node 单线程**（同内核、同 async 引擎；Node API 也是 `progress 250 / yield 50`），不存在"浏览器专属的数倍变慢"。
2. 唯一可量化的附加开销是 `yieldIntervalMs: 50` 的 `setTimeout(0)` 让步；它在 150-190 s 的运行里相当于数秒。该值硬编码在 `optimizer.ts:1004-1005`（用户不可调），而 `yieldIntervalMs:1000` 实测可回到同步基线 → 是可优化项，但不是主因。
3. 目标机器 1600 组合/s 时，283,708 组合 ≈ 177 s；与 Lead 测得的 150-180 s 一致。

## 2. 默认配置对合法空间的放大（真实库存实测）

### 2.1 默认值（已按 Lead 更正核对）

- Fioni：`data/agents.json:11813-11835` → `defaultSetIds:["freedom_blues"]`、`defaultTwoPieceSetIds:["phaethons_melody"]`、`mainStatLimits {4:[anomalyProficiency,atkPct], 5:[fireDmg,atkPct,penRatio], 6:[anomalyMastery,atkPct]}`；默认伤害事件 `:11836-11866` 为单次**异放**（`settlementType:"release"`，`triggerActorRef.profileId:"fioni_purifying_flame_release"`、`releaseSkillRef`）。
- Velina 对比：`data/agents.json:8180-8202` → 4pc `zzz_wiki_2038`、2pc `["swing_jazz","moonlight_lullaby"]`（两个）、6 号位仅 `energyRegen`；默认事件 `:8203+` 为 `settlementType:"attribute"`。
- 角色级 `preferredDriveDiscs.mainStatLimits` 确实会被内核当默认值使用：`core/driveDiscOptimizer-core.js:941-968`（显式为空时回落角色推荐）。所以**不存在"默认不限主词条"的问题**。

### 2.2 放大矩阵（真实 451 盘库存，preview 实测，默认 = 283,708）

| 场景 | estimatedCombinationCount | 相对默认 |
| --- | --- | --- |
| 1. 默认（Fioni 推荐 4pc + 1 个 2pc + 角色主词条限制） | **283,708** | 1.00× |
| 2. **清空"额外 2 件套"（=不限）** | **2,349,414** | **8.28×** |
| 3. 主词条在弹窗里显式放宽（4/5/6 全选常用主词条） | 366,385 | 1.29× |
| 4. 4 件套候选选 2 套 `[freedom_blues, fanged_metal]` | 322,784 | 1.14× |
| 5. 4 件套候选选 3 套 | 328,640 | 1.16× |
| 6. 不限 2 件套 + 2 套 4 件套候选 | **2,638,134** | **9.30×** |
| 7. 设最低面板 atk≥2500 / 异常精通≥250 | 283,708（不变） | 1.00× |

"会比 283,708 更大"的条件清单（按影响排序）：
1. **点"清空"额外 2 件套**（`WorkbenchView.vue:1608` → `clearTwoPieceSetLimits` → `optimizer.ts:639-643` 写 `twoPieceSetSource:"manual"` + 空数组；空数组语义 = 不限，见 `docs/regression-contract.md:391`）。候选池从 2 个套装扩到库存全部 21 个套装，实测 8.3×。这是最容易触达的放大开关，且 UI 文案"自动匹配任意 2 件套"看不出代价。
2. **组合 1 + 多 4 件套候选**：9.3×，且切到 ≥2,000,000 后 Node API 会并行、浏览器仍串行（契约 `regression-contract.md:399-400`），浏览器相对 Node 的时间差会从"无差"变成数倍。
3. **4 件套候选多选**（`WorkbenchView.vue:1295-1305` 多选弹窗）：每套走一次独立严格内核（`core/driveDiscOptimizer-core.js:4654-4771`），耗时近似**相加**；preview 也会为每分支各建一次状态（`:4679-4690`）。
4. **在弹窗里显式加主词条**（`OptimizerConfigModal.vue:389-393`）：显式非空会**完全覆盖**角色推荐（`driveDiscOptimizer-core.js:949-968`），1.29×（加得越多越接近全库存）。
5. **库存盘数增加**（导入更多 `freedom_blues`/`phaethons_melody`）：合法组合 ≈ 各槽候选数的乘积级别增长，实测 per-slot 候选 11/19/11/7/9/8 就已是 283,708。
6. 反向不成立：设最低面板**不减少枚举**（只在评分阶段过滤，实测组合数不变）；专属/排除记录只减不增。

### 2.3 UI 侧独立问题（非性能根因，但影响"慢"的体验与误导）

1. **复杂度档位与提示错配**：`core/driveDiscOptimizer-core.js:26-31`（<100k 较快、<1M 中等、<5M 较慢）→ 283,708 被标"中等"；`WorkbenchView.vue:673-693` 只在 `high/extreme`（≥1,000,000）才显示"候选较多，可收缩…"的建议。于是用户面对 150-190 s 的运行，界面既不预警也无 ETA，只显示百分比；该档位假设"剪枝有效"，与当前 Fioni 全枚举不符。建议按"预计耗时/剪枝是否生效"而非纯组合数给提示。
2. **"清空主词条"对推荐角色实际无效**：`OptimizerConfigModal.vue:393` 的清空把该槽置空数组；内核 `driveDiscOptimizer-core.js:955-959` 见显式为空即回落角色 `preferredDriveDiscs.mainStatLimits`。用户在 UI 上"清空"后空间不变（实测第 3 行是"显式加项"才变大），行为与按钮语义有落差（可视为预期设计，但建议 UI 说明）。
3. 其他均为正常：运行中禁用配置入口（`WorkbenchView.vue:1485`、`:1502`）、取消即时生效、看门狗文案本身已提示"先限定 2 件套或主词条"（`optimizer.ts:871`）。

## 3. 提交/工作区回归核查

- `git status --porcelain` → 仅 `?? tmp/`（本任务脚本/报告），**无未提交源码或 data 改动**；HEAD `7f4f3d4`。
- `git log` 文件级：`core/driveDiscOptimizer-core.js` 最近修改为 `c621af9`；`webapp/src/workers/optimizer.worker.ts`、`webapp/src/stores/optimizer.ts`、`OptimizerConfigModal.vue` 最近修改亦为 `c621af9` 或更早 → **26aa031 / a3c0db8 / 7f4f3d4 均未触碰优化器内核、Worker 与 store**，不存在这些提交导致的 Worker 缓存/传输回归。
- 剪枝被禁用的机制链（早于 Fioni）：
  - `core/calculator-core.js:8688-8696` 默认事件含异放 → `requiresReleaseIntervalBound: true`；
  - `core/calculator-core.js:9912-9914` `releaseIntervalBound` 只取固定目标内核的声明；
  - `core/calculator-core.js:9410-9421` 固定目标内核在存在 `dynamicFormulaEntries` 等情况下返回 null；
  - `core/driveDiscOptimizer-core.js:2543-2546` 需要区间上界而内核未声明时直接返回 `+Infinity` → 上界剪枝全部失效。
  - 该内核门槛（`git log -S compileFixedNonDirectObjectiveKernel`）与 `requiresReleaseIntervalBound`/`releaseIntervalBound`（`e59aca1`、`a90cc35`）**都早于 Fioni**；Fioni 的动态公式 `clamp(30 + max(x - 155, 0) * 0.7, 0, 100)` 在 `26aa031`、`a3c0db8`、HEAD 三个提交的 `data/agents.json` 中都存在 → **这是 Fioni 首版带进来的能力缺口，不是最近两次提交的性能回归**。
- HEAD `7f4f3d4` 的改动影响：新增 `releaseTargets` 过滤（`damageModifierAppliesTo` 每条 modifier 多一次数组判定）与 Fioni 异放暴伤 skillBuff（`defaultChecked`）。本机内核探针（`tmp/fioni-kernel-probe.mjs`）显示：**核心被动开启 → `releaseIntervalBound:false`、无 `scoreCombinedScalar`；关闭核心被动 → `true` 且有**，说明阻断项是核心被动的动态公式，而不是 HEAD 新增的暴伤 Buff。性能影响可忽略。
- a3c0db8 曾把 Fioni 推荐从 `phaethons_melody(4pc)+[chaos_jazz,hormone_punk]` 改为 `freedom_blues(4pc)+[phaethons_melody]`；前端迁移逻辑（`optimizer.ts:281-335`，`twoPieceDefaultsVersion`、`twoPieceSetSource`）对 `preferred` 来源会跟随新推荐，对 `manual` 保留用户选择 → 正常情况下默认仍收敛到本次测得的 283,708；只有用户手动清空 2 件套才会到 §2 的 2.35M。

## 4. 测试与基准覆盖缺口（成立，且比原描述更具体）

1. `tests/fioni-damage.test.js:129-135`：优化器用 `tests/fixtures/fioni-optimizer.js`，**每槽 2 个盘（共 12 盘 → 2^6 = 64 组合）**；用暴力枚举做 Top10 oracle，只断言 ID/分数，不断言 `prunedBySuperBound`、`evaluated` 或耗时。剪枝完全失效时该用例仍在毫秒级通过 → 无法发现本问题。
2. 该用例还**把无区间上界当作预期**：`tests/fioni-damage.test.js:125` 断言 `fixed.releaseIntervalBound === false`（"dynamic formula must not claim an unproven pruning bound"）。若按"补齐异放区间上界"方向修复，需要同步改这条断言，否则修复会被测试判红。
3. `webapp/e2e/fioni-modeling.e2e.ts:78-106` 虽然有"built Worker matches the Fioni optimizer oracle"，但用的仍是同一 64 组合 fixture，且 `settings: { yieldIntervalMs: 0, progressIntervalMs: 0 }` → 不覆盖真实让步/进度与规模；90 s 超时只能拦住病态慢。
4. `benchmarks/optimizer-benchmark.js:7` 只用叶瞬光直伤样例（`woodpecker_electro`/`hormone_punk`），无 Fioni、无异放/属性异常 agent 场景；断言只有 `:410-411`"medium 规模下 exact-super-bound 不慢于 exact-legacy"，没有 `prunedBySuperBound > 0`（剪枝有效性）或组合/秒阈值 → 对"剪枝静默退化"零保护。
5. 浏览器 e2e 里只有 Velina 优化器做规模/取消/复用（`webapp/e2e/velina-optimizer.e2e.ts:19-53`，含 variants 12 的大库存），Fioni 没有同等规模用例。

建议的回归断言（供 Lead/修复者参考，本次不改仓库）：
- 增加一个异放 Fioni 场景的基准/测试，断言 `prunedBySuperBound > 0` 且 `prunedBySuperBound / estimatedCombinationCount` 高于阈值（修复后），或断言 `processedCombinationCount < estimatedCombinationCount`；
- 测试 fixture 至少扩到每槽 6-8 个盘（≈10^4-10^5 组合）并在 CI 中以宽松耗时上限运行；
- benchmark 增加 Fioni 默认配置 + 真实库存快照，输出组合/秒与剪枝比例。

## 5. 复现脚本（均在 tmp/，只读）

- `tmp/fioni-defaults-probe.mjs`：小型合成库存下 Fioni 默认异放 vs 改成 attribute 的剪枝对照（`prunedBySuperBound: 0` vs 948/10,923；`evaluated: 960` vs 12）。
- `tmp/fioni-ui-path-probe.mjs`：真实库存放大矩阵 + 浏览器 runtime vs 同步内核 vs Node async 配对计时。
- `tmp/fioni-yield-overhead-probe.mjs`：`yieldIntervalMs` 50/1000/微任务让步 交错重复对照。
- `tmp/fioni-instrumented-overhead.mjs`：仪器化 `yieldControl`，给出 yield 次数与累计耗时。
- `tmp/fioni-kernel-probe.mjs`：固定套装内核能力探针（`releaseIntervalBound`、`scoreCombinedScalar` 有无，核心被动开/关对照）。

运行方式示例（Node 20，仓库为 ESM）：`node tmp/fioni-ui-path-probe.mjs`。注意：与团队其他基准并行时本机计时噪声 ±20-30%，本报告计时均标注为区间/最小值。
