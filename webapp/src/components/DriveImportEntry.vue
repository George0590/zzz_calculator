<script setup lang="ts">
import { onMounted, ref } from "vue"
import { NButton } from "naive-ui"
import { Radar, ScanLine } from "lucide-vue-next"
import { useDriveCaptureStore } from "@/stores/drive-capture"

// 驱动盘导入的统一入口：抓包与扫描二选一，主推抓包；Enka 与 JSON 作为其他方式。
defineProps<{ enkaEnabled?: boolean }>()
const emit = defineEmits<{ capture: [], scan: [], json: [], enka: [] }>()
const capture = useDriveCaptureStore()
const checking = ref(!capture.loaded)

onMounted(async () => {
  try { await capture.refresh() } catch { capture.available = false }
  finally { checking.value = false }
})
</script>

<template>
  <div class="import-entry ui-layout-scope" data-layout-surface="drive-import-entry">
    <div class="import-entry-cards">
      <article class="import-entry-card import-entry-card--recommended" data-testid="import-entry-capture">
        <header>
          <span class="import-entry-icon" aria-hidden="true"><Radar :size="20" /></span>
          <strong>抓包导入</strong>
          <span class="import-entry-badge">推荐</span>
        </header>
        <p>在游戏登录过程中读取完整驱动盘数据，包含等级与锁定状态。</p>
        <ul>
          <li>无需逐页翻看，登录完成即可</li>
          <li>仅新增与更新，不删除已有驱动盘</li>
        </ul>
        <span class="import-entry-requirement">要求：本机版计算器 · 国服 PC 客户端 · 管理员授权</span>
        <span v-if="!checking && !capture.available" class="import-entry-unavailable" role="note">
          当前环境不可用，需要使用本机版计算器并安装导出器。
        </span>
        <NButton type="primary" :disabled="checking || !capture.available" :loading="checking" @click="emit('capture')">开始抓包</NButton>
      </article>
      <article class="import-entry-card" data-testid="import-entry-scan">
        <header>
          <span class="import-entry-icon" aria-hidden="true"><ScanLine :size="20" /></span>
          <strong>扫描助手</strong>
        </header>
        <p>通过界面识别读取背包中的全部驱动盘。</p>
        <span class="import-entry-requirement">适用于云游戏、Beta 客户端，或抓包暂不支持的情况。耗时较长。</span>
        <NButton @click="emit('scan')">使用扫描助手</NButton>
      </article>
    </div>
    <p class="import-entry-others">
      其他方式：
      <template v-if="enkaEnabled"><button type="button" @click="emit('enka')">Enka 展柜（仅展柜角色）</button> · </template>
      <button type="button" @click="emit('json')">导入 JSON 文件</button>
    </p>
    <p class="import-entry-note">导入前均可预览变化；已用其他方式录入的驱动盘会提示合并，不会重复记录。</p>
  </div>
</template>

<style scoped>
.import-entry { display: grid; gap: 14px; min-width: 0; }
.import-entry-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@container (max-width: 520px) { .import-entry-cards { grid-template-columns: minmax(0, 1fr); } }
.import-entry-card {
  display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 18px;
  border: 1px solid var(--app-border); border-radius: var(--app-radius-lg); background: var(--app-panel);
}
.import-entry-card--recommended { border: 2px solid var(--app-blue); background: var(--app-blue-soft); }
.import-entry-card header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.import-entry-card strong { font-size: 16px; color: var(--app-text); }
.import-entry-icon {
  display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: none;
  border-radius: var(--app-radius); background: var(--app-panel-muted); color: var(--app-text-secondary);
}
.import-entry-card--recommended .import-entry-icon { background: var(--app-blue); color: #fff; }
.import-entry-badge { padding: 1px 8px; border-radius: 999px; background: var(--app-blue); color: #fff; font-size: 12px; font-weight: 600; }
.import-entry-card p, .import-entry-card ul { margin: 0; color: var(--app-text); font-size: 14px; line-height: 1.6; }
.import-entry-card ul { padding-left: 18px; color: var(--app-text-secondary); font-size: 13px; }
.import-entry-requirement { color: var(--app-muted); font-size: 12px; line-height: 1.5; }
.import-entry-unavailable { color: var(--app-amber-strong); font-size: 12px; line-height: 1.5; }
.import-entry-card :deep(.n-button) { align-self: flex-start; margin-top: auto; height: auto; min-height: 36px; white-space: normal; }
.import-entry-others, .import-entry-note { margin: 0; color: var(--app-muted); font-size: 13px; overflow-wrap: anywhere; }
.import-entry-note { font-size: 12px; }
.import-entry-others button { padding: 0; border: 0; background: none; color: var(--app-blue); font: inherit; cursor: pointer; }
.import-entry-others button:hover { color: var(--app-blue-strong); text-decoration: underline; }
.import-entry-others button:focus-visible { outline: var(--app-focus-ring); border-radius: 2px; }
</style>
