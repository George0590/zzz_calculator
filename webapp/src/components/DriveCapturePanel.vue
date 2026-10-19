<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { NAlert, NButton, NCheckbox, NInput, NModal, NSelect, NTag } from "naive-ui"
import DriveDiscConflictResolver from "./DriveDiscConflictResolver.vue"
import { useDriveCaptureStore } from "@/stores/drive-capture"
import { useAccountStore } from "@/stores/account"
import { useCatalogStore } from "@/stores/catalog"
import { formatStoredStatValue, storedStatLabel } from "@/utils/format"

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ "update:show": [show: boolean] }>()
const capture = useDriveCaptureStore()
const accounts = useAccountStore()
const catalog = useCatalogStore()
const ownerId = ref("")
const uid = ref("")
const mismatch = ref("")
const acknowledgeMismatch = ref(false)
const secondConfirmed = ref(false)
let polling: ReturnType<typeof setInterval> | null = null
let refreshing = false

const phases: Record<string, string> = {
  awaiting_elevation: "等待 Windows 管理员授权", preparing: "正在准备采集", waiting_login: "已就绪，请登录游戏",
  capturing: "正在采集登录数据", parsing: "正在解析驱动盘", needs_second_login: "需要第二次登录确认",
  ready: "采集完成，等待预览和入库", failed: "采集失败", cancelled: "采集已取消", timed_out: "采集已超时", cancelling: "正在停止采集",
}
const errors: Record<string, string> = {
  START_FAILED: "无法启动本机导出器，请检查安装文件和 Windows 授权。",
  CAPTURE_MUTEX_FAILED: "无法取得本机采集锁，请稍后重试。",
  PROTOCOL_INVALID: "导出器返回的状态不符合本次任务协议，结果未导入。",
  TASK_IO: "本地任务文件读写失败，请检查磁盘空间与目录权限。",
  TASK_TIMEOUT: "等待超过时间限制，已请求停止。如果 Windows 授权窗口仍在，请关闭它后重试。",
  UAC_REJECTED: "你取消了管理员授权。准备好后可以重新采集。",
  CAPTURE_BUSY: "系统已有 pktmon 采集任务，本次未启动。请先结束你正在使用的其他采集工具。",
  CAPTURE_PERMISSION: "采集权限不足，请重新启动并允许 Windows 管理员授权。",
  CAPTURE_FAILED: "无法启动或完成抓包，请检查权限和网络环境后重试。",
  RESPONSE_TIMEOUT: "没有在 3 分钟内收到支持的完整驱动盘响应。请确认国服正式 PC 客户端、版本及登录步骤。",
  SMALL_INVENTORY_UNSUPPORTED: "已收到响应，但数据量不足以让当前算法可靠恢复；首版暂不支持这类小库存。",
  EMPTY_INVENTORY: "未取得驱动盘，首版暂不支持空库存。",
  PAIRING_FAILED: "两次登录无法配对。请核对同一游戏账号、同一版本，且两次期间库存完全未改变。",
  VERSION_MAPPING: "游戏版本、套装或属性映射不受当前导出器支持。",
  RESULT_WRITE: "导出文件写入失败，请检查磁盘空间和目录权限。",
  RESULT_INVALID: "本次结果校验失败，未导入库存。",
  DECODE_FAILED: "驱动盘恢复或解码失败，未导入库存。",
  DECODE_TIMEOUT: "解析超过时间限制，已停止本次任务。",
  CONFIRM_TIMEOUT: "等待第二次登录确认超时，请重新采集。",
  SERVICE_LOST: "本地服务连接中断，采集已停止。",
  SERVICE_RESTARTED: "本地服务已重启，本次任务作废，请重新采集。",
  PROCESS_EXITED: "采集进程已退出，但未交付本次成功结果。",
}
const options = computed(() => accounts.owners.map((owner: any) => ({ label: owner.label, value: owner.id })))
const preview = computed(() => capture.plan?.preview)
const changedRows = computed(() => [
  ...(preview.value?.added ?? []).map((disc: any) => ({ key: `add-${disc.id}`, kind: "新增", after: disc })),
  ...(preview.value?.updated ?? []).map((entry: any) => ({ ...entry, key: `update-${entry.id}`, kind: "更新" })),
  ...(preview.value?.sourceMerged ?? []).map((entry: any) => ({ ...entry, key: `merge-${entry.id}`, kind: "合并来源" })),
])
const errorText = computed(() => errors[capture.task?.errorCode] || capture.task?.error || "本次采集失败，请重试。")
const canStart = computed(() => capture.available && !!ownerId.value && !capture.active && !capture.busy
  && (!mismatch.value || acknowledgeMismatch.value))

function statText(stat: any) { return `${storedStatLabel(stat.stat, stat.mode, catalog.meta)} ${formatStoredStatValue(stat.stat, stat.value, stat.mode)}` }
async function run(action: () => Promise<any>) {
  capture.error = ""
  try { await action() } catch (error: any) { capture.error = error.message }
}
async function refresh() {
  if (refreshing || capture.busy) return
  refreshing = true
  try { await capture.refresh() } catch { capture.error = "无法连接本机采集服务。恢复连接后重新打开面板可查看本次状态。" }
  finally { refreshing = false }
}
async function close() {
  if (capture.busy) return
  if (capture.active) {
    try { await capture.cancel() } catch (error: any) { capture.error = `取消请求失败：${error.message}`; return }
  }
  emit("update:show", false)
}
function selectOwner(value: string) {
  ownerId.value = value
  uid.value = capture.declaredUid(value)
  acknowledgeMismatch.value = false
}
watch(() => props.show, async show => {
  if (polling) clearInterval(polling)
  polling = null
  if (!show) return
  await run(async () => { await Promise.all([accounts.load(), catalog.load()]); await capture.refresh() })
  if (!props.show) return
  ownerId.value = capture.task?.ownerId && accounts.owners.some((owner: any) => owner.id === capture.task.ownerId)
    ? capture.task.ownerId : accounts.currentOwnerId ?? ""
  uid.value = capture.task?.ownerId === ownerId.value ? capture.task.declaredUid : capture.declaredUid(ownerId.value)
  polling = setInterval(refresh, 1000)
}, { immediate: true })
let mismatchGeneration = 0
watch([ownerId, uid], async () => {
  acknowledgeMismatch.value = false
  const generation = ++mismatchGeneration
  try { const warning = await capture.uidMismatch(ownerId.value, uid.value); if (generation === mismatchGeneration) mismatch.value = warning }
  catch (error: any) { if (generation === mismatchGeneration) mismatch.value = error.message }
})
watch(() => accounts.currentOwnerId, () => capture.invalidatePreview())
watch(() => capture.task?.phase, () => { secondConfirmed.value = false })
onBeforeUnmount(() => {
  if (polling) clearInterval(polling)
  if (props.show && capture.active) void capture.cancel().catch(() => {})
})
</script>

<template>
  <NModal :show="show" preset="card" title="抓包导入驱动盘" class="capture-modal"
    style="width: min(860px, calc(100vw - 16px))" :mask-closable="false" :close-on-esc="false"
    :closable="!capture.busy" @update:show="close">
    <div class="capture-body ui-layout-scope" data-layout-surface="drive-capture">
      <p>支持{{ capture.supportedClient }}。先让游戏停在登录页，开始采集并允许管理员授权，等下方显示“已就绪”后再登录。</p>
      <NAlert v-if="capture.loaded && !capture.available" type="warning">当前环境没有可用的本机抓包导出器。请使用本机计算器，并按安装说明准备导出器。</NAlert>
      <div class="ui-field-grid">
        <label data-layout-field>目标计算器账号
          <NSelect :value="ownerId" :options="options" :disabled="capture.active || capture.busy" aria-label="抓包目标计算器账号" @update:value="selectOwner" />
        </label>
        <label data-layout-field>游戏 UID（可留空跳过）
          <NInput v-model:value="uid" :disabled="capture.active || capture.busy" placeholder="填写游戏 UID 或留空" aria-label="抓包声明 UID" />
        </label>
      </div>
      <p class="capture-hint">UID 是你填写的声明，导出器不会核验实际登录账号。留空将显示“未提供 UID”。盘的游戏物品 ID 与账号 UID 分开处理。</p>
      <NAlert v-if="mismatch" type="warning">
        {{ mismatch }}
        <NCheckbox v-model:checked="acknowledgeMismatch" :disabled="capture.active || capture.busy">我已核对目标账号，确认调整本次声明 UID（不修改 Enka 绑定）</NCheckbox>
      </NAlert>
      <NButton :disabled="!canStart" :loading="capture.busy && !capture.plan" @click="run(() => capture.start(ownerId, uid, acknowledgeMismatch))">
        {{ ownerId && ownerId !== accounts.currentOwnerId ? '切换到所选账号并开始采集' : capture.task ? '新建一次采集' : '开始采集' }}
      </NButton>
      <div v-if="capture.task" class="capture-status" role="status" aria-live="polite">
        <strong>{{ capture.imported ? '已导入本地库存' : phases[capture.task.phase] || '正在读取任务状态' }}</strong>
        <span>本次固定目标：{{ capture.task.ownerLabel }} · {{ capture.task.declaredUid ? `声明 UID：${capture.task.declaredUid}（未核验）` : '未提供 UID' }} · 第 {{ capture.task.round }} 轮</span>
        <p v-if="capture.task.phase === 'awaiting_elevation'">请处理 Windows 授权窗口。拒绝授权会结束本次任务；授权后仍需等待“已就绪”再登录。</p>
        <p v-if="capture.task.phase === 'waiting_login'">现在可以点击游戏登录。进入游戏后保持库存不变，等待自动完成。</p>
        <p v-if="capture.task.phase === 'ready' && !capture.imported">已取得 {{ capture.task.discCount }} 张盘。尚未入库，请先预览差异。</p>
        <p v-if="capture.task.processRunning && ['failed', 'timed_out'].includes(capture.task.phase)">已发出取消，正在等待进程退出；如果 Windows 授权窗口仍在，请关闭它。</p>
      </div>
      <NAlert v-if="capture.ownerProblem" type="warning">{{ capture.ownerProblem }}</NAlert>
      <NButton v-if="capture.ownerProblem && accounts.owners.some((owner: any) => owner.id === capture.task?.ownerId)"
        :disabled="capture.busy" @click="run(() => accounts.switchTo(capture.task.ownerId))">切回采集目标账号</NButton>
      <NAlert v-if="capture.task?.phase === 'needs_second_login'" type="warning">
        第一次恢复未成功，需要同一账号再登录一次。请完全退出游戏，再启动并停在登录页。
        两次之间不要获取、拆解、强化、换装、锁定或解锁驱动盘，也不要更换游戏版本。
        <NCheckbox v-model:checked="secondConfirmed">我确认仍为同一游戏账号、同一版本，库存没有变化，游戏已停在登录页</NCheckbox>
        <NButton :disabled="!secondConfirmed || !!capture.ownerProblem || capture.busy" @click="run(() => capture.continueSecond())">开始第二轮采集</NButton>
      </NAlert>
      <NAlert v-if="['failed', 'timed_out'].includes(capture.task?.phase)" type="error">
        {{ errorText }}<span v-if="capture.task.errorCode">（{{ capture.task.errorCode }}）</span>
      </NAlert>
      <NAlert v-if="capture.notice" type="info">{{ capture.notice }}</NAlert>
      <NAlert v-if="capture.error" type="error" role="alert">{{ capture.error }}</NAlert>
      <template v-if="preview">
        <div class="capture-summary">
          <NTag>当前 {{ preview.currentCount }} → {{ preview.nextCount }}</NTag>
          <NTag type="success">新增 {{ preview.summary.added }}</NTag>
          <NTag type="info">更新 {{ preview.summary.updated }}</NTag>
          <NTag>未变 {{ preview.summary.skipped }}</NTag>
          <NTag>合并来源 {{ preview.summary.sourceMerged }}</NTag>
          <NTag type="warning">待确认 {{ preview.summary.conflicts }}</NTag>
        </div>
        <p>本次仅新增和更新，不删除缺失盘；保留已有配装、角色专属、排除和穿戴关系。</p>
        <NAlert v-for="warning in preview.warnings" :key="warning" type="warning">{{ warning }}</NAlert>
        <DriveDiscConflictResolver :conflicts="capture.plan.conflicts" :resolutions="capture.draft.resolutions"
          :disabled="capture.busy || !!capture.ownerProblem" :meta="catalog.meta" @resolve="resolution => run(() => capture.resolve(resolution))" />
        <div v-if="changedRows.length" class="capture-differences">
          <p>变化明细（展示前 {{ Math.min(30, changedRows.length) }} 条，共 {{ changedRows.length }} 条）：</p>
          <article v-for="row in changedRows.slice(0, 30)" :key="row.key">
            <strong>{{ row.kind }} · {{ row.after.setName }} · {{ row.after.partition }} 号位</strong>
            <span v-if="row.before">原记录：等级 {{ row.before.level }}，{{ row.before.locked ? '游戏已锁定' : '游戏未锁定' }}，{{ statText(row.before.mainStat) }}；{{ row.before.subStats.map(statText).join('、') }}</span>
            <span>本次：等级 {{ row.after.level }}，{{ row.after.locked ? '游戏已锁定' : '游戏未锁定' }}，{{ statText(row.after.mainStat) }}；{{ row.after.subStats.map(statText).join('、') }}</span>
          </article>
        </div>
      </template>
      <NAlert v-if="capture.imported" type="success">本次结果已提交到目标账号的本地库存。再次导入相同游戏物品不会新增副本。</NAlert>
      <p class="capture-hint">关闭面板会请求取消正在进行的采集；刷新后可重新打开查看任务。登录与第二轮确认各限 3 分钟，解析限 2 分钟，总任务最多 10 分钟。网络采集文件仅保留在本机。</p>
    </div>
    <template #footer>
      <div class="capture-footer">
        <NButton :disabled="capture.busy" @click="close">{{ capture.active ? '取消采集并关闭' : '关闭' }}</NButton>
        <NButton v-if="capture.task?.phase === 'ready' && !capture.imported" :disabled="capture.busy || !!capture.ownerProblem" @click="run(() => capture.preview())">{{ capture.plan ? '重新预览' : '预览差异' }}</NButton>
        <NButton v-if="capture.plan" type="primary" :loading="capture.busy" :disabled="capture.busy || !!capture.ownerProblem || capture.plan.hasUnresolvedConflicts" @click="run(() => capture.confirm())">确认入库</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.capture-body { display: grid; gap: 12px; min-width: 0; max-height: 65vh; overflow-y: auto; overflow-wrap: anywhere; }
.capture-body p { margin: 0; }
.capture-body label { display: grid; gap: 6px; min-width: 0; }
.capture-hint { color: var(--app-muted); font-size: 12px; }
.capture-status, .capture-differences article { display: grid; gap: 6px; padding: 12px; background: var(--app-panel-muted); border-radius: 8px; }
.capture-differences { display: grid; gap: 8px; }
.capture-summary, .capture-footer { display: flex; flex-wrap: wrap; gap: 8px; }
.capture-footer { justify-content: flex-end; }
.capture-body :deep(.n-checkbox) { margin: 8px 0; }
.capture-body :deep(.n-button), .capture-footer :deep(.n-button) { height: auto; min-height: 34px; white-space: normal; }
.capture-body :deep(.n-button__content), .capture-footer :deep(.n-button__content) { white-space: normal; overflow-wrap: anywhere; }
</style>
