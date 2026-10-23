# 菲欧妮（fioni）驱动盘优化速度慢：代码级根因分析与修复方案

- 分析日期：2026-10-24
- 分析范围：只读 `core/`、`data/`、`tests/`；未修改任何仓库源码/数据，临时脚本与证据均在 `tmp/`。
- 复现环境：`node`（v20）、Windows；`algorithm: "exact-super-bound"`。
- 证据脚本与输出：
  - `tmp/fioni-rootcause-probe.mjs` → `tmp/fioni-rootcause-evidence.txt`
  - `tmp/formula-interval-proto.mjs` → `tmp/formula-interval-proto-output.txt`
  - `tmp/leaf-scoring-benchmark.mjs` → `tmp/leaf-scoring-benchmark-output.txt`
  - 原始性能探针（Lead 提供、已复跑）：`tmp/fioni-probe.mjs`

---

## 0. 结论（TL;DR）

1. **不是菲欧妮的伤害/建模错误，也不是剪枝逻辑本身错误，而是"区间上界实现缺口 + 安全阀过度保守"**：
   菲欧妮核心被动把「初始异常掌控 → 灼蚀异常暴击率」写成了一条**通用 `type: "formula"` 动态公式规则**（`data/agents.json:11241-11267`，表达式 `clamp(30 + max(x - 155, 0) * 0.7, 0, 100)`，目标为属性异常/乱流/异放）。
2. 这条规则经 `isDeferredInCombatFormula` 进入 `dynamicFormulas`（`core/calculator-core.js:1163-1166`、`1490-1517`、`1611-1629`），使 `dynamicFormulaEntries.length > 0`（`8949-8954`）。
3. 两个 "fixed 套装内核" 都用 `dynamicFormulaEntries.length` 做**一刀切的安全拒绝**：
   - `compileFixedDirectScoreKernel`：`core/calculator-core.js:9126-9133`
   - `compileFixedNonDirectObjectiveKernel`：`core/calculator-core.js:9410-9421`（第 9413 行）
   于是菲欧妮走不到已有的 release 区间求值代码（`9788-9866`），`compileForSetCounts()` 返回
   `scoreKernel: "compiled-dense-fixed-sets"`、`releaseIntervalBound: false`、没有 `scoreObjectiveScalar`（`9878-9916`，尤其 `9914`）。
4. `optimizerStatMetadata` 同时给出 `strictMonotonic: false`、`requiresReleaseIntervalBound: true`（`core/calculator-core.js:8688-8696`）。
5. 严格优化器在 `superBoundScoreDense` 开头直接返回 `+Infinity`（`core/driveDiscOptimizer-core.js:2539-2546`），**不计数 `superBoundChecks`、不剪枝**；结果 `evaluated == estimated`，且每个叶子还走最慢的 map 评分路径（`2506-2517`、`3559-3566`）。
6. 实测：默认菲欧妮输入、3 变体/套（10935 组合）在 exact-super-bound 下 **10041 ms、`prunedBySuperBound=0`、`superBoundChecks=0`**；
   仅把这一条公式规则在内存目录中移除后 **210 ms、`prunedBySuperBound=10925`、`objectiveScalarCalls=2494`**。Lead 在真实库存（`data/user_drive_discs.json`，283708 组合）上测得 ~150 s → 0.66 s，量级一致。
7. **`docs/regression-contract.md:120-121` 的"缺少标记必须返回无限上界并禁止剪枝"是刻意的安全设计，应保留**。
   真正的缺口是：**固定套装 objective kernel 没有任何机制把"可证明区间安全"的动态公式纳入区间上界**；菲欧妮这条 clamp 是其中最典型、也是当前唯一一条落在该缺口里的规则（详见 §4）。
8. 推荐修复（方案 A，纯代码、零数据改动、可证明）：给 `compileFixedNonDirectObjectiveKernel` 增加一个**白名单动态公式类别**（初始异常掌控 → 异常暴击率，表达式形状与 `compileInitialEnergyFormula` 同类），在 `scoreObjectiveScalar` 里按"精确值 / 区间最大值"分别求值，并在该类别全部命中时把 `releaseIntervalBound` 置真。预期恢复到 ~0.2–1 s 量级（12 号位 6 候选：10935 → 10 个叶子；真实库存 28 万 → 预计数千个叶子）。
9. 叶子评分 map 路径（`2506-2517`）确实比 dense/objective kernel 慢 ~3–40 倍，但**修好上界后不再是主因**；建议作为独立的 P2 性能项，不要与本次修复混在一起。

---

## 1. 完整链路（代码 → 现象）

```
data/agents.json:11241-11267  fioni.combatBuffs.corePassive.effects[1]
  id=fioni-sear-crit-rate-attribute, type=formula, scope=inCombat,
  stat=anomalyCritRate, target.kind=anomaly{attribute,turbulence,release},
  source.kind=outOfCombatStat, source.stat=anomalyMastery, source.unit=storedValue,
  formula.expression="clamp(30 + max(x - 155, 0) * 0.7, 0, 100)", valueUnit=storedPercent
        │
        │  isOutOfCombatFormulaRule(rule)=true 且 isInitialMasteryAnomalyCritRule(rule)=true
        │  （core/effectFormula.js:39-52）
        ▼
normalizeEffect()  → dynamicFormulas = rules.filter(isDeferredInCombatFormula)
        │  core/calculator-core.js:1163-1166（scope=inCombat 且 (inCombatStat 公式 | 初始掌控暴击公式)）
        │  core/calculator-core.js:1490-1517
        ▼
compileDenseCombatEffectEntry() → entry.dynamicFormulas（core/calculator-core.js:1561-1634）
        ▼
compileDensePanelScoreTarget()：entries + dynamicFormulaEntries
        │  core/calculator-core.js:8747-8944（entries 构造）
        │  core/calculator-core.js:8949-8954（dynamicFormulaEntries = entries.flatMap(...)）
        ▼
compileForSetCounts()（core/calculator-core.js:9878-9916）
  ├─ compileFixedDirectScoreKernel  : dynamicFormulaEntries.length → null   (9126-9133)
  ├─ compileFixedNonDirectObjectiveKernel : dynamicFormulaEntries.length → null (9410-9421, 行 9413)
  └─ 返回 { scoreKernel:"compiled-dense-fixed-sets", releaseIntervalBound:false, // 9913-9914
            scoreObjectiveScalar:undefined, scoreCombinedScalar:undefined }
        ▼
createOptimizerState()：optimizerStatMetadata
  strictMonotonic=false（有 release 且有动态公式，8688-8696）
  requiresReleaseIntervalBound=true（有 release 事件，8693）
        ▼
buildSuperBoundPlan() → compileSpecializedPlanScoreKernel()（driveDiscOptimizer-core.js:1945-2025）
  fixed kernel 为 fallback 时：scoreKernel="compiled-dense-fixed-sets"、
  scoreObjectiveScalar 缺失 → objectiveScalarFallbacks=1 / reason="unsupported-objective"
        ▼
superBoundScoreDense()（driveDiscOptimizer-core.js:2539-2546）
  if (requiresReleaseIntervalBound && specializedScoreKernel.releaseIntervalBound !== true)
      return +Infinity;   // 不计数 superBoundChecks，不剪枝
        ▼
checkSuperBoundPrune()（2909-2964）拿不到有限上界 → 永不剪枝
        ▼
全量枚举；每个叶子 evaluateSelected→selectedScoreOnlySummary
  （2506-2517：super-bound 算法强制 scoreSelectedDiscsInSlotOrder → scoreOnlyFromMaps，
   3559-3566）→ 单次 0.5–1.0 ms 的 map 评分
        ▼
实测 10935 组合 ≈ 10 s；真实库存 283708 组合 ≈ 150 s
```

关键证据（`tmp/fioni-rootcause-evidence.txt`）：

| 变体 | metadata | fixed kernel | 优化器（10935 组合，6 候选/号位） |
|---|---|---|---|
| A 原始（release + 动态公式） | `strictMonotonic:false, requiresReleaseIntervalBound:true` | `scoreKernel:compiled-dense-fixed-sets`, `releaseIntervalBound:false`, 无 objective/combined | 10041 ms，evaluated 10935/10935，`prunedBySuperBound:0`，`superBoundChecks:0`，`objectiveScalarFallbacks:1("unsupported-objective")` |
| A-attr 同 Buff、属性异常事件 | `requiresReleaseIntervalBound:false` | 同上（fallback） | 712 ms，evaluated 10，`prunedBySuperBound:10925` |
| B 内存中仅移除暴击公式规则、仍是 release | `requiresReleaseIntervalBound:true` | `scoreKernel:compiled-objective-fixed-sets`, `releaseIntervalBound:true`, 有 objective/combined | 210 ms，evaluated 10，`prunedBySuperBound:10925`，`objectiveScalarCalls:2494` |
| B2 关闭整个核心被动、release | `requiresReleaseIntervalBound:true` | objective, `releaseIntervalBound:true` | 234 ms，evaluated 10，`prunedBySuperBound:10925` |

补充证据（同一探针 §5）：同一块驱动盘把局外异常掌控抬到 240 时，

- A（规则生效）：`anomalyCritRate=0.895`、`finalDamage=42433.1`
- B（规则移除）：`anomalyCritRate=0`、`finalDamage=24727.9`
- B2（核心被动关闭）：`finalDamage=17167.2`

即**这条动态公式对评分影响巨大，fixed kernel 不能"视而不见"**——这解释了为什么 9413 行的拒绝是必要的，而不是作者忘了算。

---

## 2. 缺口判定：为什么现成的 `9788-9866` 区间机制没有覆盖菲欧妮

问题 (a) 的答案分三层：

### 2.1 `9788-9866` 服务的是"已物化在事件上的表达式/专用 stat"，不是动态公式

`compileFixedNonDirectObjectiveKernel.scoreObjectiveScalar`（9555-9862）里的区间逻辑只覆盖两类来源：

1. **事件级异放倍率表达式**：`event.releaseProfile` 通过 `evaluateAnomalyReleaseProfileInterval(...)`（`core/anomalyRelease.js:584-601`，区间算术在 `469-558`）求 `finalBaseMultiplier.max`（`calculator-core.js:9788-9802`）。
2. **两条"固定 stat 形态"的特殊转换**：
   - `event.anomalyCritRatePerInitialMasteryAbove100`：用 `calculateInitialMasteryConvertedAnomalyCritRate(formulaOutOfCombatIntervalPanel.anomalyMastery.max, rate)` 求区间上界（`9818-9825`）。这是 Aria 1 影使用的专用 stat。
   - `event.releaseProfile.critRateBonusExpression`：用 `evaluateReleaseExpressionInterval(...)` 求 `.max`（`9827-9838`）。

这三类数据在**编译期**就进入了 `compiledEvents`（`releaseProfile`、`releaseCoreScalingRow`、`releaseSkillMultiplier` 从事件复制；`anomalyCritRatePerInitialMasteryAbove100` 由 `fillDenseModifierSums` 预先把事件修正和写进 `sums`），所以 kernel 内层循环可以只做纯算术。

**动态公式不属于这套结构**：它不是事件修正，而是"随候选面板变化的第二条求值通道"。在 `scoreDense` 里它由 `resolveDynamicCombatFormulas(...)` 在**每次候选评分时**求值（`core/calculator-core.js:9062-9109`），并作为额外的 `eventModifierEntries` 注入 `calculateCompiledDamageScoreValueDense`。fixed kernel 里没有任何代码读取它；若忽略，异常暴击率就会少掉最多 89.5 个百分点（见 §1 证据），**精确评分直接错**，上界也无从谈起。因此 `9413` 行是"这套内核无法表达该输入"的安全阀，而不是对具体公式保守程度的判断。

### 2.2 为什么不能直接让 dense 回退路径充当 release 上界

`superBoundScoreDense` 的 release 安全门槛（`driveDiscOptimizer-core.js:2543-2546`）只认 fixed kernel 的 `releaseIntervalBound` 标记，原因在 `scoreDense`：release 倍率走 `compiledEventBaseMultiplier(...)`（非区间求值），它把"聚合最大值面板"当成一个点求值。对 `multiply/clamp` 这类单调表达式这恰好是上界，但对 `subtract/divide/min/max(floor)` 等表达式不保证。fixed kernel 的 `9788-9866` 才是唯一**按区间算术**认证过的路径，所以设计上不接受 dense 结果作为 release 上界。`docs/regression-contract.md:120-121` 正是这条约束。

### 2.3 菲欧妮这条 clamp 与 `anomalyCritRatePerInitialMasteryAbove100` 的差异（关键对照）

| 维度 | Aria 1 影专用 stat | 菲欧妮核心被动 |
|---|---|---|
| 数据形态 | `type:"fixed"`、`stat:"anomalyCritRatePerInitialMasteryAbove100"`、`value:0.5`（`data/agents.json` aria.cinemaBuffs[0]） | `type:"formula"`、`stat:"anomalyCritRate"`、`source.kind:"outOfCombatStat"`、带 `formula.expression`（`data/agents.json:11241-11267`） |
| 计算入口 | `fillDenseModifierSums` 写入 `sums["anomalyCritRatePerInitialMasteryAbove100"]` → `resolveAnomalyCritForEvent`/`denseAnomalyCritMultiplier` 统一换算 | `dynamicFormulas` → `resolveDynamicCombatFormula` → 额外 `eventModifierEntries`（`9062-9109`） |
| 阈值/基数 | 固定阈值 100、无基数（`calculateInitialMasteryConvertedAnomalyCritRate`，`calculator-core.js:4697-4701`；常量 `INITIAL_ANOMALY_MASTERY_CRIT_THRESHOLD`） | 基数 30%、阈值 155、每点 0.7%、上限 100% |
| 区间实现 | kernel 已有（`9818-9825`，用 `formulaOutOfCombatIntervalPanel.anomalyMastery.max`） | 无（被 `9413` 挡在门外） |
| 能否数据层复用 | —— | 不能直接复用：阈值/基数不同，且专用 stat 的 `value` 只有"每点系数"一个参数 |

因此这不是"作者漏掉了菲欧妮"，而是**专用 stat 只能表达 Aria 那一种参数形态，无法表达"基数+阈值+每点系数+上限"的通用 clamp**。

---

## 3. 为什么说"安全设计是对的，问题在上界实现缺口"

- 契约 `docs/regression-contract.md:117-126`（异放条款）明确：
  > 固定套装异放评分内核只有在区间上界已经实现时才能声明 `releaseIntervalBound: true`……缺少标记的回退路径必须继续返回无限上界并禁止剪枝，不能以性能为由牺牲精确性。
- 现有测试也是按这条契约写的：`tests/fioni-damage.test.js:111-127`，第 125 行
  `assert.equal(fixed.releaseIntervalBound, false, 'dynamic formula must not claim an unproven pruning bound')`。
  这行测试**目前是正确的**：在现有实现下，菲欧妮确实没有可证明的区间上界。它记录的是"现状契约"，不是"目标契约"。
- 同类对照说明这是"缺口"而非"故意针对"：
  - `tests/aria-damage.test.js:916-930`：Aria 1 影专用 stat → `releaseIntervalBound:true`；
  - `tests/vivian-damage.test.js:348-362`：Vivian → true；`:391-393`：带动态 `outOfCombatStat` 要求的回退 → false（与契约一致）；
  - `tests/velina-damage.test.js:297`：Velina → true；
  - `tests/velina-optimizer.test.js:94`：所有 release 场景 kernel 必须 true；
  - `tests/optimizer-fuzz.test.js:512-559`：Vivian release fuzz 断言 `superBoundChecks>0`、`prunedBySuperBound>0`、`scored+pruned==estimated`、Top10 与 exact-legacy 一致；
  - `tests/browser-local-compute.test.js:360-427`：浏览器 Worker 同款断言。

结论：**修复方向应是"为这一类动态公式补上可证明的区间上界"，而不是放宽 9413 行或 2543 行的安全门槛。**

---

## 4. 是否菲欧妮专属

全角色扫描（探针 §7，遍历 `data/agents.json` 所有角色 `combatBuffs` 中的 formula 规则）：

| 角色 | 相关 formula 规则 | 归类 | 是否落入 fixed kernel 拒绝条件 | 影响 |
|---|---|---|---|---|
| **fioni** | `fioni-sear-crit-rate-attribute`（初始掌控 → 异常暴击率） | `isInitialMasteryAnomalyCritRule` = true，且被 `isDeferredInCombatFormula` 收进 `dynamicFormulas` | **是**（唯一一个） | release 事件被禁剪枝 |
| velina | `velina-energy-damage-bonus`、`velina-energy-mastery-bonus`（能量回复 → 增伤/异常精通） | `isOutOfCombatFormulaRule`，但不是初始掌控暴击类 | 否：走 `compileDenseCombatEffectEntry` 的 `outOfCombatFormulas`（`1584-1605`，`compileInitialEnergyFormula` 编译成功），变成 kernel 已支持的 `initialFormulaEntries`（`9555-9575` 的 `masteryBonus/lowerMasteryBonus` 区间） | 正常 |
| aria | 无 formula 规则；1 影用专用 stat `anomalyCritRatePerInitialMasteryAbove100` | 固定修正 stat | 否：kernel 已有专用区间分支（`9818-9825`） | 正常 |
| vivian | 无 formula 规则；异放倍率靠 `releaseProfile.expression` | 事件级表达式 | 否：kernel 用 `evaluateAnomalyReleaseProfileInterval` | 正常 |
| nangongyu | `initial-mastery-to-impact`（初始掌控 → 冲击力） | `isOutOfCombatFormulaRule`，但 `compileInitialEnergyFormula` 返回 null（source 不是 energyRegen）→ `compileDenseCombatEffectEntry` 返回 `{unsupported:true}`（`1591-1594`）→ `compileDensePanelScoreTarget` 直接 null | 否（根本没进 dense kernel） | 走 map 路径；**仍能剪枝**：实测 64 组合 884 ms、evaluated 22、pruned 42 |
| jane_doe | 3 条 `isInCombatFormulaRule`（异常精通 → 暴击率/增伤/攻击） | 动态公式 | 是（若有 release 事件；jane 无 release profile） | 非 release 目标时 dense 回退上界可用，不受 release 门槛影响 |

要点：

1. **触发条件是"release 事件 + 通用动态公式"这一组合**。菲欧妮是当前唯一同时满足"有异放方案 + 有 deferred 动态公式"的角色。所以现象是菲欧妮专属，但**缺陷是通用机制缺口**：未来任何角色用通用 formula 规则写"初始掌控→异常暴击率"之类，都会同样掉进全枚举。
2. 顺带发现一个**性能一致性问题**（不是正确性问题）：`nangongyu` 因为 dense target 为 null，退回 map 路径后**仍能剪枝**；`fioni` 因为 dense target 存在、但 fixed kernel 被拒，反而进入"dense 精确评分 + 禁用剪枝"的最差组合。换言之，`dense 可用 + releaseIntervalBound=false` 比 `dense 不可用` 更慢。这可以作为修复价值的额外论据，也提示后续可考虑"release + 无上界时回退 map 剪枝路径"的兜底，但**该兜底的 map 上界本身也未经区间认证**（见 §5 方案 C2），不建议作为正式修复。

---

## 5. 修复方案

### 方案 A（推荐，最小且可证明）：白名单动态公式 + objective kernel 区间支持

**思路**：不追求"支持任意动态公式"，只支持**表达式形状可静态证明单调**的一类：`stat=anomalyCritRate`、`isInitialMasteryAnomalyCritRule(rule)=true`（`core/effectFormula.js:47-52`）、`source.unit=storedValue`、`valueUnit=storedPercent`、目标为通用异常暴击目标、且没有随候选变化的 `outOfCombatStat` requirement/覆盖率依赖。对这类规则，解析 `clamp(BASE + max(x - THRESHOLD, 0) * RATE, 0, CAP)`（或带 `formula.parameters` 的等价形式），得到 `evaluate(rawMastery)`；因为表达式对 x 单调不减、`anomalyCritMultiplierForMode` 对 critRate 单调不减（`core/anomalyCrit.js:18-23`，且 rate 被夹到 `[0,1]`），所以：

- **精确路径**（`scoreObjectiveScalar` 不传区间向量）：用 `outPanelValue("anomalyMastery")` 的精确局外面板值求值 → 与 dense 完全一致；
- **上界路径**（传 `suffixDenseVector/branchIndexedVector/optimisticIndexedVector`）：`outPanelValue(...)` 本身就是该子树候选的**聚合最大值**（kernel 对 atk/proficiency/dmg 的既有单调假设，`9555-9701`），对单调公式求值即得区间上界。

**改动点**（约 80–120 行）：

1. `core/effectFormula.js`
   - 仿照 `compileInitialEnergyFormula`（`57-90`）新增 `compileInitialMasteryAnomalyCritFormula(rule)`：
     解析 `clamp(BASE + max(x - THRESHOLD, 0) * RATE, 0, CAP)`，支持数字字面量 + `formula.parameters` 常量（沿用 `formulaParameterValues`，`155-166`），返回 `{ evaluate(rawMastery): number /* storedPercent 单位 */, monotoneNonDecreasing: true }`，不支持形状一律返回 null。
   - 该 helper 只做语法白名单与数值求值，不改变现有 `evaluateFormulaExpression` 行为。
2. `core/calculator-core.js`
   - 在 `compileDenseCombatEffectEntry` 的 `dynamicFormulas` 映射处（`1611-1629`）为可支持条目附加编译期结果（如 `intervalSafe: { evaluate, coverage, modifierFactor }`）；`coverageFromRuntime`/`applyBuffModifiersToResolvedRule` 同此处可用。
   - `compileFixedNonDirectObjectiveKernel` 守卫（`9412-9421`）：把 `dynamicFormulaEntries.length` 改为
     “存在**本方案内实际生效**（`fixedEntryFlags[entry.entryIndex]`）且不在支持白名单内的动态公式才 return null”；
     同时把活跃动态公式列表保存在 kernel 闭包中。
   - `compiledEvents`（`9424-9547`）逐事件预计算“该事件是否命中该动态公式目标”：复用 `dynamicFormulaTargetAppliesTo(rule)` + `damageModifierAppliesToCompiledEvent`（`2731-2755`、`1850-1862`），即与 dense `9062-9109` 完全相同的目标判定。
   - `scoreObjectiveScalar` 内：
     - 在 `anomalyCritRate` 参与 `anomalyCritMultiplierForMode` 的地方（`9840-9845`）加上动态公式值；区间路径用 `outPanelValue("anomalyMastery")`（已是子树最大值），精确路径用同一函数（等于精确值）。
     - 若事件目标不命中则加 0；`critMode: "nonCrit"`/无异常暴击时 `anomalyCritMultiplierForMode` 自然为 1，无需特判。
   - `releaseIntervalBound`（`9866`）：改为 `compiledEvents.some(e => e.isRelease) && 活跃动态公式全部在白名单内`（非 release 目标时该字段无意义，保持现状即可）。
   - `compileFixedDirectScoreKernel`（`9126-9133`）**保持不动**：菲欧妮是异常事件，direct kernel 本来不适用；未来若要支持“直伤 + 动态公式”再单独处理。
3. `core/driveDiscOptimizer-core.js`：**无需改动**。`compileForSetCounts()` 的返回值结构、`compileSpecializedPlanScoreKernel` 的 probe 自检（`1945-2025`）、`superBoundScoreDense` 的安全门槛（`2539-2546`）都原样复用：一旦 `releaseIntervalBound` 变 true，`scoreCombinedScalar` 自动被采用，`superBoundChecks>0`、剪枝恢复。
4. `docs/regression-contract.md:120-121`、`docs/fioni-modeling.md`、`tests/fioni-damage.test.js:125` 需要与代码同步更新（详见 §6）。

**性能预期**：以 10935 组合的探针用例，从 A 的 10041 ms 降到 **B 的 210 ms 量级**（预期略差，因为 crit 区间上界比“无 crit”松，见风险）；真实库存 283708 组合预计 **0.2–1.5 s**（达到 Lead 测得的 0.66 s 量级）。验收指标：`superBoundChecks>0`、`prunedBySuperBound>0`、`scored+pruned==estimated`、Top10 与全枚举一致。

**正确性风险**：

- 精确评分风险：`scoreObjectiveScalar` 精确路径若与 dense 有偏差，`compileSpecializedPlanScoreKernel` 的 2 个探针向量会检测到 mismatch 并自动回退（fail-safe 到现状慢路径），**不会出错误结果**；但只有 2 个探针，必须补 fuzz/oracle 测试。
- 上界有效性风险：依赖 (i) 白名单公式对 x 单调不减（解析器按构造保证）、(ii) `outPanelValue` 对子树是面板最大值（kernel 既有假设，`9555-9701`）、(iii) crit 乘区对 critRate 单调（`anomalyCrit.js:18-23`）、(iv) 其他乘区非负。建议加一个“上界 ≥ 精确”的 property test（随机 stat 向量 + 随机区间向量），以及 Top10 与穷举一致性的端到端测试。
- 覆盖率/倍率器风险：`coverage`、`buffModifiers`、`formula.parameters`（core 档位物化）必须在精确/区间两条路径上用同一因子；不支持就返回 null（保守拒绝）。
- 范围风险：白名单只命中“初始掌控→异常暴击率”类；jane 的 `inCombatStat` 动态公式、nangongyu 的 initial 公式仍按现状处理（null/unsupported），行为不变。

### 方案 A2（更长线）：通用公式区间求值器

把 `core/formulaEvaluator.js` 扩展为“数值求值 + 区间求值”（AST 解析 + 区间算术，覆盖 `+ - * / floor ceil round min max clamp`；除法跨零时拒绝）。已做原型验证（`tmp/formula-interval-proto.mjs`）：对 fioni/velina/jane 的 5 种实际表达式、每式 180 万次随机 x×区间采样，**0 次 enclosure 违例**（`tmp/formula-interval-proto-output.txt`）。之后：

- `dynamicFormulaEntries` 标注 `intervalSafe`（由 `evaluateFormulaExpressionInterval` 编译成功且输出 stat 属于 kernel 可承载的集合决定）；
- `compileFixedNonDirectObjectiveKernel` 守卫改为“全部 intervalSafe”；
- `scoreObjectiveScalar` 里对所有白名单输出（`anomalyCritRate` 等）用区间代理求值。

**优点**：一次覆盖未来更多动态公式（包括直接伤事件的 `dmgBonus/atkFlat` 类，需处理面板反馈顺序）；**缺点**：改动面大（新解析器 + 与 `applyDynamicCombatFormulas` 的求值顺序对齐 + 直伤 kernel 也要改），回归成本高。**建议作为方案 A 之后的第二步，不在本次修复中实施。**

### 方案 B（不推荐）：数据层参数化专用 stat

把菲欧妮规则改写成类似 Aria 的 `anomalyCritRatePerInitialMasteryAbove100` 新 stat（`{base,threshold,rate,cap}` 参数化），复用 kernel 的专用区间分支。

- 优点：kernel 改动最小。
- 缺点：需要改 `data/agents.json`（新增 stat 类型/字段语义）、`core/maintenanceValidation.js` 校验、维护端保存/回读、白盒说明、`docs/fioni-modeling.md`、历史迁移；且和现有“公式规则”通道重复。风险/工作量都高于方案 A，只在产品明确要求“数据可参数化”时采用。

### 方案 C（备选）：optimizer 层“放宽但可证明”的上界

不碰精确评分，只为 bound 提供一个“常量上界内核”：

- 对不支持的动态公式，按 AST 静态求其全局最大值（如 `clamp(...,0,100)%` → 100%），bound 里把对应异常暴击率固定为 1.0；
- `compileForSetCounts()` 额外返回 `boundOnlyObjectiveScalar`；`superBoundScoreDense` 在 `releaseIntervalBound !== true` 时改用该 bound 内核（并仍返回 `+Infinity` 若连它都没有）。

**优点**：不需要区间算术，精确路径零改动。**缺点**：上界更松（fioni 的实际初始掌控范围 152–197.6 → 真实 crit 30%–59.8%，固定 100% 会带来 ~25% 的伤害上界松弛，剪枝率下降）；且“全局最大”的静态求值本身需要表达式解析；“宽松上界仍是上界”需要严格论证，契约文档也要改写。**推荐度低于 A。**

### 方案 C2（不建议）：让 `compileDensePanelScoreTarget` 对“release + 不可证明”返回 null，退回 map 剪枝路径

实测 `nangongyu`（dense target=null）反而能剪枝（884 ms / 64 组合、pruned 42）。理论上把菲欧妮也打回 map 路径可立即恢复剪枝，但：

- map 路径的上界（`scoreOnlyFromMaps` → `scoreOnlyFromSummary`）同样在聚合最大值面板上对 release 表达式求值，**同样没有区间认证**，等于绕过契约 120-121 的安全要求；
- 会丢掉 dense/objective kernel 的性能提升，且大幅改动 `compileDensePanelScoreTarget` 的返回语义与现有测试假设。
不推荐；但它说明了一个值得记录的机制不一致：当前“dense 可用但上界被拒”比“dense 不可用”更慢。

### 方案 P2（可选性能项，建议单独立项）：叶子评分改走 dense/objective kernel

`selectedScoreOnlySummary`（`driveDiscOptimizer-core.js:2506-2517`）在 super-bound 算法下**无条件**走 `scoreSelectedDiscsInSlotOrder → scoreOnlyFromMaps`，即每个叶子 0.5–1.0 ms；而 `state.selectedStatValues/selectedSetCountValues` 在 `pushSelectedDisc/popSelectedDisc`（`3642-3677`）里已经实时维护，`evaluateSelectedForSeedCutoff`（`3693-3709`）也已经示范了“用 dense kernel 评叶子”的写法。

微基准（`tmp/leaf-scoring-benchmark-output.txt`，同一面板/词条）：

| 路径 | 耗时 |
|---|---|
| `map scoreOnlyFromSummary`（当前叶子路径） | 974 µs/call |
| `indexed scoreOnlyFromIndexedSummary` | 699 µs/call |
| `dense scoreDense` | 300 µs/call |
| `fixed-dense-fallback scoreScalar`（fioni 当前 fallback kernel） | 294 µs/call |
| `calculate full` | 6981 µs/call |

即修好上界后若只评估 ~10 个叶子，叶子路径完全不是瓶颈（B 变体 210 ms 中主要是 768 次 seed dense 评分 + 准备阶段）；只有“上界被禁用/失效”或“剪枝很弱”时才需要 P2。**结论：不需要和本次主修复一起做；可作为后续优化，预期 3–4 倍（fioni fallback）/更高（有 objective kernel 的角色）。**

---

## 6. 精确性与验收：修复后如何保证 exact == 穷举 Top10（问题 c）

### 6.1 代码内的三道保险（现有机制，修好即可复用）

1. `compileSpecializedPlanScoreKernel`（`driveDiscOptimizer-core.js:1945-2025`）对每个 plan 的 kernel 做 2 个探针向量的 `scoreOnlySummariesMatch` 对比；不一致 → 回退 dense（不剪枝，慢但不跳步）。
2. `strictExact: true` / `scoredCombinationCount + prunedBySuperBound == estimatedCombinationCount` 的计数对账（`1323`、`3443-3444`、`tests/optimizer.test.js:509`）。
3. `checkSuperBoundPrune`（`2909-2964`）只在 `upperBound + EPS < cutoff` 时剪枝，且 `usableBoundScore` 拒绝 `NaN`；异常时 `safeBoundFallbacks++` 并返回 `+Infinity`（不剪）。

### 6.2 必须新增/修改的回归测试

1. **`tests/fioni-damage.test.js`**
   - 第 111-127 行：`fixed.releaseIntervalBound` 断言由 `false` 改为 `true`（并改断言文案，说明“初始掌控 clamp 已具备区间上界”）；同时断言 `scoreKernel === "compiled-objective-fixed-sets"`、`typeof fixed.scoreObjectiveScalar === "function"`。
   - 在现有的 `fixed.scoreScalar == dense.scoreDense == calculate` 多重一致基础上，补充：
     - 局外异常掌控网格 `[0, 100, 150, 154, 155, 155.5, 200, 254.9, 255, 300]`；
     - `critMode ∈ {expected, crit, nonCrit}`；
     - 事件组合覆盖 `release / attribute / turbulence / disorder / direct` 混合（现有循环已覆盖，修好后仍必须全绿）；
     - `scoreScalar`（精确）与 `scoreObjectiveScalar`（精确、无向量）与 `calculate()` 独立算例三者一致（白盒 + 编译路径交叉验证，参照 `tests/aria-damage.test.js:904-930` 的写法）。
   - **上界性质测试**：对随机 `statValues` / 随机 `suffixDenseVector+branchIndexedVector+optimisticIndexedVector`，断言 `scoreObjectiveScalar(...)` 的 `finalDamage` ≥ 同一子树内任意真实候选的 `scoreDense(...)`（至少覆盖随机子集 + 真实 store 抽样）。
2. **`tests/optimizer-fuzz.test.js`**：仿照 `VIVIAN_RELEASE_FUZZ_CASES`（`512-559`）新增 `FIONI_RELEASE_FUZZ_CASES`：
   - 覆盖 `coreSkillLevel A-F`、`cinemaLevel 0/1/4/6`、`purifying_flame / soul_searching_blaze / c4_extra` 三个异放方案、≥3 组 4+2 套装；
   - 每个场景断言 `strictExact`、`superBoundChecks>0`、`prunedBySuperBound>0`、`scored+pruned==estimated`、Top10（ID 与 score）与 `exact-legacy` 全枚举一致。
3. **`tests/browser-local-compute.test.js`**：仿照 Vivian Worker 段（`360-427`）增加菲欧妮 release Worker 用例，断言剪枝发生、`scored+pruned==estimated`、Top10 与 Node legacy 一致（浏览器 Worker 与 Node 共用 `core/`，但必须显式覆盖）。
4. **`tests/in-combat-formula.test.js` / `tests/formula.test.js`**：新增 `compileInitialMasteryAnomalyCritFormula` 的单测：
   - `x=154/155/155.5/200/255/256` 的取值（含上限 100、下限 30）；
   - 不支持的形状（如 `subtract/divide`、`valueUnit` 非 storedPercent、source 非 anomalyMastery）必须返回 null（保守拒绝）。
5. **最小面板约束场景**：带 `settings.minimums` 时 `useObjectiveScalar=false`，上界走 `kernel.scoreScalar(聚合最大值)` 路径；补一条 `minimums` 下的 Top10 一致性与“有剪枝”断言。
6. **并行/Worker 路径**：`exact-super-bound-parallel` 用例（已有，`tests/fioni-damage.test.js:135`）修好后仍应通过；可另断言其 `prunedBySuperBound > 0`。
7. **benchmark**：`benchmarks/optimizer-benchmark.js` 若把菲欧妮纳入场景，需更新基线（当前无 fioni 专用场景，可加一个 release 剪枝基线）。

### 6.3 契约/文档同步（与代码同一提交）

- `docs/regression-contract.md:120-121`：把“只有在区间上界已经实现时才能声明 `releaseIntervalBound: true`”补充说明**新增的可证明类别**（“初始异常掌控 → 异常暴击率的 clamp 公式，经白名单解析器证明单调后参与固定套装 objective kernel 的区间上界”），并保留“其他动态公式缺失标记时仍返回无限上界、禁止剪枝”的安全条款。
- `docs/fioni-modeling.md`：在“异放与默认目标”或新增“优化器”小节记录该规则已进入固定套装区间上界（并说明不支持时的回落行为）。
- `tests/fioni-damage.test.js:125`：旧断言文案 `'dynamic formula must not claim an unproven pruning bound'` 必须替换；否则文档/契约与测试三方冲突。
- `AGENTS.md` 的“修改公式时验证独立算例、作用与排除目标，并覆盖普通计算、白盒、编译评分、固定套装、Worker 和优化器路径”是本次验收的最低范围，全部要跑：`npm run test:fioni-damage`、`npm run test:optimizer`、`npm run test:optimizer-fuzz`、`npm run test:browser-local-compute`、`npm run test:aria-damage`、`npm run test:vivian-damage`、`npm run test:velina-damage`、`npm run test:formula`、`npm run test:compiled-score`、`npm run test:compiled-panel-score`。

### 6.4 性能验收

以 3 变体/套探针（10935 组合）与真实库存（283708 组合）各跑：
`algorithm: exact-super-bound` 要求 `superBoundChecks > 0`、`prunedBySuperBound > 0`、`evaluated + prunedBySuperBound == estimatedCombinationCount`、Top10 与 `exact-legacy`（关剪枝）一致；目标时间：探针 ≤ 0.5 s，真实库存 ≤ 2 s（参考方案 B 的 0.66 s）。

---

## 7. 风险与未决问题清单

1. **白名单表达式形状**：方案 A 的解析器必须对“未识别形状”返回 null（保守拒绝），不要用宽松正则误判；建议同步 `validateFormulaExpression` 语义，保证维护端/运行时/优化器一致。
2. **`outPanelValue` 作为子树最大值的假设**：kernel 现有代码已对 atk/anomalyProficiency/dmgBonus 依赖同一假设；本次新增只读取 `anomalyMastery` 的同一最大值，理论上安全，但需要 §6.2 的上界性质测试兜底。
3. **strictMonotonic 仍为 false**：修复只恢复 release 上界/`superBoundChecks`，不会恢复 dominance/relevant-stat/frontier 压缩（这些依赖 `strictMonotonic`）。变体 B 实测剪枝 10925/10935，说明不影响本次目标；如果后续需要更强剪枝，应单独评估“动态公式的单调性对 dominance 剪枝的影响”。
4. **nangongyu 类“dense target null → map 剪枝”仍存在上界未经区间认证的隐患**：本报告只做记录，不在本次范围内；建议另开 issue 审计 map 路径 release 上界的合法性。
5. **`compileFixedDirectScoreKernel` 仍会对含动态公式的直伤目标返回 null**：菲欧妮不受影响；若未来有“直伤 + 初始掌控转换”角色，需要同样处理（方案 A2 的自然延伸）。
6. **浏览器 Worker 产物的构建**：`core/` 改动会进入 Worker bundle，验收需重新构建并跑 `tests/browser-local-compute.test.js`；生产部署按发布手册另行授权（本次不涉及部署）。
7. **不要用“去掉 corePassive / 删除规则”作为临时方案**：会改变伤害语义（§1 证据：critRate 0.895→0、伤害 42433→24728），属于用户可见的错误结果。

---

## 8. 关键 file:line 索引

- 数据规则：`data/agents.json:11241-11267`（`fioni-sear-crit-rate-attribute`，`11264` 为表达式）
- 公式分类：`core/effectFormula.js:39-52`（规则判定）、`57-90`（`compileInitialEnergyFormula` 先例）
- 动态公式归集：`core/calculator-core.js:1163-1166`、`1490-1517`、`1561-1634`（`1611-1629`）
- 动态公式表：`core/calculator-core.js:8949-8954`
- fixed 内核拒绝：`core/calculator-core.js:9126-9133`、`9410-9421`（关键行 `9413`）
- 既有区间机制：`core/calculator-core.js:9555-9701`（区间面板/`hasFormulaInterval`）、`9788-9866`（release 表达式区间、`9866` `releaseIntervalBound`）
- 专用 stat 区间：`core/calculator-core.js:9818-9825`；换算函数 `4697-4701`
- `compileForSetCounts`：`core/calculator-core.js:9878-9916`（`9913-9914` 关键返回）
- 优化器 metadata：`core/calculator-core.js:8573-8696`（`8690-8693`）
- 剪枝安全门槛：`core/driveDiscOptimizer-core.js:2539-2546`
- 专业化 kernel/自检：`core/driveDiscOptimizer-core.js:1945-2025`（探针 `2000-2010`）
- 叶子评分路径：`core/driveDiscOptimizer-core.js:2506-2517`、`3559-3566`、`3642-3677`、`3693-3709`
- 契约：`docs/regression-contract.md:117-126`（`120-121` 核心）
- 现有测试：`tests/fioni-damage.test.js:111-127`（`125` 关键断言）、`tests/aria-damage.test.js:916-930`、`tests/vivian-damage.test.js:348-393`、`tests/velina-damage.test.js:297`、`tests/velina-optimizer.test.js:94`、`tests/optimizer-fuzz.test.js:512-559`、`tests/browser-local-compute.test.js:360-427`

## 9. 证据文件

- `tmp/fioni-rootcause-probe.mjs` / `tmp/fioni-rootcause-evidence.txt`：metadata、dense/fixed kernel 字段、四种变体的优化器指标、全角色公式规则扫描、代表角色 release 配置。
- `tmp/formula-interval-proto.mjs` / `tmp/formula-interval-proto-output.txt`：区间求值器原型及 900 万次采样 enclosure 验证（0 违例）。
- `tmp/leaf-scoring-benchmark.mjs` / `tmp/leaf-scoring-benchmark-output.txt`：叶子评分路径微基准。
- `tmp/fioni-probe.mjs`：原始 end-to-end 性能探针（Lead 提供）。
