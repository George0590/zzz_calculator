<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { NAlert, NButton, NInput, NModal, NSelect } from "naive-ui"
import ConfirmDialog from "./ConfirmDialog.vue"
import { useBuildStore } from "@/stores/build"
import { useAccountStore } from "@/stores/account"
import { useCatalogStore } from "@/stores/catalog"
import { useOptimizerStore } from "@/stores/optimizer"
import { calculationPresets, saveCalculationPreset, pinCalculationPreset, deleteCalculationPreset, validatePresetInventory } from "@runtime/calculation-presets"
import { calculateInCombatPanel } from "@core/calculator-core.js"
import { formatNumber, formatPercent, formatStoredStatValue, storedStatLabel, labelOf, statLabel, damageEventSummaryTitle } from "@/utils/format"
const props = defineProps<{ discs: any[], options?: any, disabled?: boolean }>()
const build = useBuildStore(), accounts = useAccountStore(), catalog = useCatalogStore(), optimizer = useOptimizerStore()
const name = ref(""), selected = ref(""), error = ref(""), busy = ref(false), compare = ref(false), confirmDelete = ref(false)
const group = ref<any>({ entries: [], pinnedId: "" })
let contextVersion = 0
const selection = computed(() => group.value.entries.find((entry: any) => entry.id === selected.value))
const pinned = computed(() => group.value.entries.find((entry: any) => entry.id === group.value.pinnedId))
function refresh() {
  try { group.value = calculationPresets(accounts.currentOwnerId ?? "", build.agentId); error.value = "" }
  catch (failure) { error.value = (failure as Error).message; group.value = { entries: [], pinnedId: "" } }
}
watch(() => [accounts.currentOwnerId, build.agentId], () => {
  contextVersion++
  refresh()
  selected.value = ""
  compare.value = false
  confirmDelete.value = false
}, { immediate: true })
async function act(action: () => Promise<any>, onSuccess?: () => void) {
  if (busy.value) return
  const version = contextVersion
  busy.value = true; error.value = ""
  try {
    await action()
    if (version === contextVersion) {
      refresh()
      onSuccess?.()
    }
  } catch (failure) {
    if (version === contextVersion) error.value = (failure as Error).message
  }
  finally { busy.value = false }
}
function save() {
  if (props.disabled) return
  const input = build.buildInput(catalog.catalog, catalog.meta, props.discs, props.options)
  const config = build.configurationSnapshot()
  void act(() => saveCalculationPreset(name.value, config, input), () => { name.value = "" })
}
function apply() {
  const entry = selection.value
  if (!entry) return
  void act(async () => {
    const config = await validatePresetInventory(entry)
    optimizer.reset()
    const runtimeDocument = optimizer.preparePresetRuntimeSettings(entry.input.combatBuffs?.runtimeInputs ?? {})
    await build.applyCalculationPreset(config, catalog.meta, async () => { await validatePresetInventory(entry) }, runtimeDocument)
    if (accounts.currentOwnerId === config.ownerId && build.agentId === config.agentId) {
      optimizer.fourPieceBuffMode = "manual"
      optimizer.fourPieceBuffRuntimeInputs = runtimeDocument.inputs
    }
  })
}
const comparison = computed(() => {
  if (!compare.value || !pinned.value) return null
  try {
    const a = pinned.value.input
    const b = build.buildInput(catalog.catalog, catalog.meta, props.discs, props.options)
    return { a, b, aResult: calculateInCombatPanel(catalog.catalog, a), bResult: calculateInCombatPanel(catalog.catalog, b), error: "" }
  } catch (failure) { return { error: (failure as Error).message } as any }
})
const score = (result: any) => result?.damage?.score ?? result?.damage?.totalFinalDamage ?? result?.damage?.finalDamage
const comparable = computed(() => comparison.value && !comparison.value.error
  && comparison.value.aResult?.damage?.objectiveKind === comparison.value.bResult?.damage?.objectiveKind)
const panelKeys = ["hp", "atk", "def", "critRate", "critDmg", "sheerForce", "lacerationDmg", "impact", "anomalyProficiency", "anomalyMastery", "penFlat", "penRatio", "dmgBonus"]
const percentStats = new Set(["critRate", "critDmg", "lacerationDmg", "penRatio", "dmgBonus"])
const panelValue = (key: string, value: number) => percentStats.has(key) ? formatPercent(value) : formatNumber(value, 1)
const changed = (a: any, b: any) => JSON.stringify(a) !== JSON.stringify(b)
const entityName = (id: string) => labelOf([...(catalog.meta?.agents ?? []), ...(catalog.meta?.wEngines ?? []), ...(catalog.meta?.combatBuffs ?? [])].find((row: any) => row.id === id)) || id
const conditionRows = computed(() => {
  const data = comparison.value
  if (!data || data.error) return []
  const describe = (input: any) => ({
    character: `${entityName(input.agentId)} · ${input.agentLevel}级 · ${input.cinemaLevel}影 · 核心 ${input.coreSkillLevel} · 潜能 ${input.potentialLevel}`,
    engine: `${entityName(input.wEngineId)} · ${input.wEngineLevel}级 · 精 ${input.wEngineModificationLevel}`,
    buffs: (input.combatBuffs?.activeBuffIds ?? []).map(entityName).join('、') || '无',
    events: (input.damage?.events ?? []).map((event: any) => `${damageEventSummaryTitle(event, catalog.meta)}${event.stunned ? '（失衡）' : '（非失衡）'}`).join('；'),
  })
  const a = describe(data.a), b = describe(data.b)
  return [ ['角色', a.character, b.character], ['音擎', a.engine, b.engine], ['队友与 Buff', a.buffs, b.buffs], ['计算事件', a.events, b.events] ]
})
const conditionLabels: Record<string, string> = { defense: '防御', level: '等级', presetId: '敌方预设', resistanceByElement: '元素抗性',
  physical: '物理', ice: '冰', fire: '火', electric: '电', ether: '以太', wind: '风', stunMultiplier: '失衡倍率', initialStunMultiplier: '初始失衡倍率',
  runtimeInputs: '触发参数', effects: '效果', coverage: '覆盖率', stacks: '层数', count: '次数', mode: '模式', target: '敌人', events: '事件',
  elapsedSeconds: '已流逝秒数', stunned: '是否失衡', skillMultiplier: '技能倍率', critMode: '暴击方式', skillRef: '技能来源',
  skillLevelsByCategory: '技能等级', normal: '普通攻击', dodge: '闪避', assist: '支援', special: '特殊技', chain: '连携技' }
function details(value: any): string {
  if (value == null) return '无'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.map(details).join('；')
  if (typeof value === 'object') return Object.entries(value).map(([key, val]) => `${conditionLabels[key] || entityName(key)}：${details(val)}`).join('；')
  return typeof value === 'string' ? entityName(value) : String(value)
}
function discDetails(input: any, slot: number) {
  const disc = input.driveDiscs.find((item: any) => Number(item.partition) === slot)
  if (!disc) return "空槽位"
  const set = catalog.meta?.driveDiscSets?.find((item: any) => item.id === disc.setId)
  const stat = (value: any) => `${storedStatLabel(value?.stat, value?.mode, catalog.meta)} ${formatStoredStatValue(value?.stat, value?.value, value?.mode)}`
  return `${labelOf(set) || disc.canonicalSetName || disc.setName || disc.setId} · ${disc.rarity} +${disc.level}\n主词条：${stat(disc.mainStat)}\n副词条：${(disc.subStats ?? []).map(stat).join('；') || '无'}\n盘 ID：${disc.id}`
}
</script>

<template>
  <section class="workbench-section" data-layout-surface="calculation-presets">
    <div class="panel-header"><h2 class="panel-title">计算方案</h2></div>
    <div class="panel-body section-band">
      <NAlert v-if="error" type="error">{{ error }}</NAlert>
      <NInput v-model:value="name" placeholder="方案名称，如失衡爆发" aria-label="计算方案名称" :disabled="busy" maxlength="80" />
      <NButton :disabled="busy || disabled || !name.trim()" :loading="busy" @click="save">保存当前完整方案</NButton>
      <NSelect v-model:value="selected" :options="group.entries.map((entry: any) => ({ label: entry.name, value: entry.id }))" placeholder="选择已保存方案" aria-label="已保存计算方案" :disabled="busy" />
      <div class="toolbar">
        <NButton :disabled="busy || !selection" @click="apply">应用方案</NButton>
        <NButton :disabled="busy || !selection" @click="act(() => pinCalculationPreset(accounts.currentOwnerId!, build.agentId, selected))">固定为 A</NButton>
        <NButton :disabled="busy || !selection" @click="confirmDelete = true">删除</NButton>
      </div>
      <p v-if="pinned">固定 A：{{ pinned.name }}（保存时的完整盘与条件）</p>
      <NButton :disabled="!pinned || busy || disabled" @click="compare = true">对比 A 与当前 B</NButton>
    </div>
  </section>
  <ConfirmDialog :show="confirmDelete" title="删除计算方案" :message="`删除「${selection?.name ?? ''}」，库存和当前计算条件保持原样。`" :busy="busy" danger
    @update:show="value => confirmDelete = value" @confirm="act(() => deleteCalculationPreset(accounts.currentOwnerId!, build.agentId, selected), () => { confirmDelete = false; selected = '' })" />
  <NModal v-model:show="compare" preset="card" title="计算方案 A / B 对比" style="width: min(1060px, calc(100vw - 24px))">
    <NAlert v-if="comparison?.error" type="error">{{ comparison.error }}</NAlert>
    <div v-else-if="comparison" class="comparison-content" data-layout-surface="calculation-comparison">
      <p>A：{{ pinned?.name }}；B：当前工作台。两者均使用当前计算公式，A 使用保存时的盘和条件。</p>
      <NAlert v-if="!comparable" type="warning">计算目标类型不同，数值不能直接计算提升比例。</NAlert>
      <table class="data-table comparison-numbers"><thead><tr><th>项目</th><th>方案 A</th><th>方案 B</th><th>B − A</th></tr></thead><tbody>
        <tr>
          <th>伤害 / 目标评分</th>
          <td data-label="方案 A">{{ formatNumber(score(comparison.aResult)) }}</td>
          <td data-label="方案 B">{{ formatNumber(score(comparison.bResult)) }}</td>
          <td data-label="B − A">{{ comparable ? formatNumber(score(comparison.bResult) - score(comparison.aResult)) : '不可直接比较' }}</td>
        </tr>
        <tr v-for="key in panelKeys" :key="key">
          <th>局内 {{ statLabel(key, catalog.meta) }}</th>
          <td data-label="方案 A">{{ panelValue(key, comparison.aResult.inCombat?.panel?.[key] ?? 0) }}</td>
          <td data-label="方案 B">{{ panelValue(key, comparison.bResult.inCombat?.panel?.[key] ?? 0) }}</td>
          <td data-label="B − A">{{ panelValue(key, (comparison.bResult.inCombat?.panel?.[key] ?? 0) - (comparison.aResult.inCombat?.panel?.[key] ?? 0)) }}</td>
        </tr>
      </tbody></table>
      <table class="data-table"><thead><tr><th>条件</th><th>A</th><th>B</th><th>差异</th></tr></thead><tbody>
        <tr v-for="row in conditionRows" :key="row[0]"><th>{{ row[0] }}</th><td>{{ row[1] }}</td><td>{{ row[2] }}</td><td>{{ changed(row[1], row[2]) ? '不同' : '相同' }}</td></tr>
        <tr v-for="slot in [1,2,3,4,5,6]" :key="slot"><th>{{ slot }} 号位</th><td class="disc-details">{{ discDetails(comparison.a, slot) }}</td><td class="disc-details">{{ discDetails(comparison.b, slot) }}</td><td>{{ changed(comparison.a.driveDiscs.find((disc: any) => Number(disc.partition) === slot), comparison.b.driveDiscs.find((disc: any) => Number(disc.partition) === slot)) ? '不同' : '相同' }}</td></tr>
      </tbody></table>
      <details><summary>查看敌人、Buff 触发参数及事件完整条件</summary>
        <table class="data-table"><thead><tr><th>条件</th><th>A</th><th>B</th></tr></thead><tbody>
          <tr v-for="key in ['target','events','skillLevelsByCategory']" :key="key"><th>{{ conditionLabels[key] }}</th><td>{{ details(comparison.a.damage?.[key]) }}</td><td>{{ details(comparison.b.damage?.[key]) }}</td></tr>
          <tr><th>Buff 触发参数</th><td>{{ details(comparison.a.combatBuffs) }}</td><td>{{ details(comparison.b.combatBuffs) }}</td></tr>
        </tbody></table>
      </details>
    </div>
    <template #footer><NButton @click="compare = false">关闭</NButton></template>
  </NModal>
</template>

<style scoped>
.comparison-content { display: grid; gap: 16px; max-height: 70vh; overflow: auto; }
.comparison-content table { table-layout: fixed; width: 100%; }
.comparison-content th, .comparison-content td { white-space: normal; overflow-wrap: anywhere; min-width: 0; }
.comparison-content .disc-details { white-space: pre-line; }
@container (max-width: 600px) {
  .comparison-numbers thead { display: none; }
  .comparison-numbers tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .comparison-numbers th { grid-column: 1 / -1; padding: 8px 6px 0; border-bottom: none; }
  .comparison-numbers td { padding: 6px; }
  .comparison-numbers td::before { content: attr(data-label); display: block; font-size: 11px; color: var(--app-text-muted); }
}
</style>
