<script setup lang="ts">
import { computed } from "vue"
import { statLabel, formatNumber, formatPercent } from "@/utils/format"

const props = withDefaults(defineProps<{
  panel: Record<string, number> | null | undefined
  /** 局内面板；缺失时局内列显示占位符，不做任何增量推导 */
  inCombatPanel?: Record<string, number> | null
  meta?: any
  includeSheerForce?: boolean
  importantStats?: string[] | null
}>(), {
  inCombatPanel: undefined,
  includeSheerForce: false,
  importantStats: () => [],
})

const percentStats = new Set([
  "critRate",
  "critDmg",
  "lacerationDmg",
  "penRatio",
  "dmgBonus",
  "physicalDmg",
  "fireDmg",
  "iceDmg",
  "electricDmg",
  "etherDmg",
  "windDmg",
  "energyRegen",
])

const baseKeys = [
  "hp",
  "atk",
  "def",
  "critRate",
  "critDmg",
  "impact",
  "anomalyProficiency",
  "anomalyMastery",
  "penFlat",
  "penRatio",
  "dmgBonus",
]

const keys = computed(() => {
  const hasLaceration = Number(props.panel?.lacerationDmg ?? 0) > 0 || Number(props.inCombatPanel?.lacerationDmg ?? 0) > 0
  const domainKeys = hasLaceration
    ? [...baseKeys.slice(0, 5), "lacerationDmg", ...baseKeys.slice(5)]
    : baseKeys
  return props.includeSheerForce
    ? ["hp", "atk", "sheerForce", ...domainKeys.slice(2)]
    : domainKeys
})

const importantStatKeys = computed(() => new Set(
  (Array.isArray(props.importantStats) ? props.importantStats : []).filter(Boolean).map(String),
))

function formatPanelValue(key: string, value: number): string {
  if (key === "anomalyMastery") {
    return formatNumber(Math.trunc(value), 0)
  }
  if (key === "lacerationDmg") {
    return formatPercent(value)
  }
  return percentStats.has(key) ? formatPercent(value) : formatNumber(value, key === "atk" ? 0 : 1)
}

// 按展示精度比较，避免浮点尾差被当成增益
function cellValue(values: Record<string, number> | null | undefined, key: string): string {
  if (!values) return "—"
  return formatPanelValue(key, values[key] ?? 0)
}
</script>

<template>
  <table class="data-table">
    <thead>
      <tr>
        <th scope="col" class="panel-stat-head panel-stat-head--label">属性</th>
        <th scope="col" class="panel-stat-head">局外</th>
        <th scope="col" class="panel-stat-head">局内</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="key in keys" :key="key">
        <th :class="{ 'panel-stat-important': importantStatKeys.has(key) }">{{ statLabel(key, meta) }}</th>
        <td class="num panel-stat-out">{{ cellValue(panel, key) }}</td>
        <td class="num panel-stat-in">{{ cellValue(inCombatPanel, key) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.panel-stat-important {
  color: var(--app-highlight);
  font-weight: 700;
}

.panel-stat-head {
  color: var(--app-muted);
  font-size: 12px;
  font-weight: 700;
  text-align: right;
}

.panel-stat-head--label {
  text-align: left;
}

.panel-stat-out,
.panel-stat-in {
  text-align: right;
}

.panel-stat-in {
  font-weight: 700;
}
</style>
