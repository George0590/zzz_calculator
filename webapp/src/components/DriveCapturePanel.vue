<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { NAlert, NButton, NCheckbox, NInput, NModal, NSelect, NSpin, NTag } from "naive-ui"
import DriveDiscConflictResolver from "./DriveDiscConflictResolver.vue"
import { useDriveCaptureStore } from "@/stores/drive-capture"
import { useAccountStore } from "@/stores/account"
import { useCatalogStore } from "@/stores/catalog"
import { formatStoredStatValue, storedStatLabel } from "@/utils/format"
import { CAPTURE_ERROR_DETAILS, captureFailureCategory, captureFailureGuide } from "@/utils/drive-capture-failures"
import { normalizeDeclaredUid } from "@core/drive-disc-capture.js"

// 抓包导入向导：一步一屏，每屏一个主操作。步骤由任务阶段推导，后端与任务状态机不变。
type DraftStep = "intro" | "target" | "prepare"
type Step = DraftStep | "unavailable" | "authorize" | "login" | "working" | "second" | "review" | "done" | "failed"

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ "update:show": [show: boolean], "use-scanner": [] }>()
const capture = useDriveCaptureStore()
const accounts = useAccountStore()
const catalog = useCatalogStore()
const INTRO_KEY = "zzz-calculator.capture-intro-dismissed.v1"
const LOGIN_LIMIT_MS = 180_000

const ownerId = ref("")
const uid = ref("")
const mismatch = ref("")
const acknowledgeMismatch = ref(false)
const secondConfirmed = ref(false)
const gameAtLogin = ref(false)
const noOtherCapture = ref(false)
const introDismissChecked = ref(false)
const introShown = ref(false)
const draftStep = ref<DraftStep>("target")
// 上一次任务已结束、用户选择重新开始时，不再展示旧任务状态
const composing = ref(true)
const showDetails = ref(false)
const now = ref(Date.now())
const decodeFailures = ref(new Set<string>())
let polling: ReturnType<typeof setInterval> | null = null
let refreshing = false

function readIntroDismissed() { try { return localStorage.getItem(INTRO_KEY) === "1" } catch { return false } }
function saveIntroDismissed() { try { localStorage.setItem(INTRO_KEY, "1") } catch { /* 仅影响下次是否显示说明 */ } }

const step = computed<Step>(() => {
  const task = capture.task
  if (capture.loaded && !capture.available && !capture.active) return "unavailable"
  if (task && (capture.active || !composing.value)) {
    if (capture.imported) return "done"
    const phase = task.phase
    if (["awaiting_elevation", "preparing"].includes(phase)) return "authorize"
    if (phase === "waiting_login") return "login"
    if (["capturing", "parsing", "cancelling"].includes(phase)) return "working"
    if (phase === "needs_second_login") return "second"
    if (phase === "ready") return "review"
    if (["failed", "timed_out", "cancelled"].includes(phase)) return "failed"
    return "working"
  }
  return draftStep.value
})
const stepGroup = computed(() => ({
  intro: 0, target: 0, prepare: 1, authorize: 1, login: 2, working: 2, second: 2, review: 3, done: 3,
} as Record<string, number>)[step.value] ?? -1)
const stepLabels = ["账号", "准备", "登录", "入库"]

const options = computed(() => accounts.owners.map((owner: any) => ({ label: owner.label, value: owner.id })))
const ownerLabel = (id: string) => accounts.owners.find((owner: any) => owner.id === id)?.label ?? ""
const normalizedUid = computed(() => { try { return normalizeDeclaredUid(uid.value) } catch { return "" } })
const uidInvalid = computed(() => { try { normalizeDeclaredUid(uid.value); return "" } catch (error: any) { return error.message } })
const uidOwner = computed(() => normalizedUid.value
  ? accounts.owners.find((owner: any) => owner.id !== ownerId.value && capture.declaredUid(owner.id) === normalizedUid.value) ?? null
  : null)
const targetLine = computed(() => {
  const task = capture.task && (capture.active || !composing.value) ? capture.task : null
  const label = task?.ownerLabel ?? ownerLabel(ownerId.value)
  const declared = task ? task.declaredUid : normalizedUid.value
  return `将导入到：${label} · ${declared ? `声明 UID ${declared}（未核验）` : "未提供 UID"}`
})
const switchingAccount = computed(() => !!ownerId.value && ownerId.value !== accounts.currentOwnerId)
const canLeaveTarget = computed(() => !!ownerId.value && !uidInvalid.value && (!mismatch.value || acknowledgeMismatch.value))
const canStart = computed(() => capture.available && canLeaveTarget.value && gameAtLogin.value && noOtherCapture.value
  && !capture.active && !capture.busy)
const countdown = computed(() => {
  const phaseAt = Number(capture.task?.phaseAt)
  if (!Number.isFinite(phaseAt) || phaseAt <= 0) return ""
  const remaining = Math.max(0, Math.ceil((phaseAt + LOGIN_LIMIT_MS - now.value) / 1000))
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
})
const workingLabel = computed(() => ({
  capturing: "正在采集登录数据", parsing: "正在解析驱动盘", cancelling: "正在停止采集",
} as Record<string, string>)[capture.task?.phase] ?? "正在读取任务状态")
const failure = computed(() => {
  const task = capture.task
  if (!task) return null
  if (task.phase === "cancelled") {
    return { title: "采集已取消", description: "可重新开始。", detail: "", primaryLabel: "重新开始", primaryAction: "restart" as const, code: "" }
  }
  const code = task.errorCode ?? ""
  return { ...captureFailureGuide(code, decodeFailures.value.size), detail: CAPTURE_ERROR_DETAILS[code] || task.error || "", code }
})
const preview = computed(() => capture.plan?.preview)
const changedRows = computed(() => [
  ...(preview.value?.added ?? []).map((disc: any) => ({ key: `add-${disc.id}`, kind: "新增", after: disc })),
  ...(preview.value?.updated ?? []).map((entry: any) => ({ ...entry, key: `update-${entry.id}`, kind: "更新" })),
  ...(preview.value?.sourceMerged ?? []).map((entry: any) => ({ ...entry, key: `merge-${entry.id}`, kind: "合并来源" })),
])

function statText(stat: any) { return `${storedStatLabel(stat.stat, stat.mode, catalog.meta)} ${formatStoredStatValue(stat.stat, stat.value, stat.mode)}` }
async function run(action: () => Promise<any>) {
  capture.error = ""
  try { await action() } catch (error: any) { capture.error = error.message }
}
async function refresh() {
  now.value = Date.now()
  if (refreshing || capture.busy) return
  refreshing = true
  try { await capture.refresh() } catch { capture.error = "无法连接本机采集服务。恢复连接后重新打开可查看本次状态。" }
  finally { refreshing = false }
}
async function close() {
  if (capture.busy) return
  if (capture.active) {
    try { await capture.cancel() } catch (error: any) { capture.error = `取消请求失败：${error.message}`; return }
  }
  emit("update:show", false)
}
async function cancelTask() {
  await run(async () => { await capture.cancel(); composing.value = true; draftStep.value = "prepare" })
}
function selectOwner(value: string) {
  ownerId.value = value
  uid.value = capture.declaredUid(value)
  acknowledgeMismatch.value = false
}
function finishIntro() {
  if (introDismissChecked.value) saveIntroDismissed()
  draftStep.value = "target"
}
function restart(target: DraftStep = "prepare") {
  composing.value = true
  draftStep.value = target
  gameAtLogin.value = false
  noOtherCapture.value = false
  capture.error = ""
}
function failurePrimary() {
  if (failure.value?.primaryAction === "scan") emit("use-scanner")
  else restart("prepare")
}
async function copyDiagnostics() {
  const task = capture.task
  if (!task) return
  try { await navigator.clipboard.writeText([task.errorCode, task.id, task.phase, task.error].filter(Boolean).join(" ")) } catch { /* 剪贴板不可用时忽略 */ }
}
async function start() {
  await run(async () => { await capture.start(ownerId.value, uid.value, acknowledgeMismatch.value); composing.value = false })
}

watch(() => props.show, async show => {
  if (polling) clearInterval(polling)
  polling = null
  if (!show) return
  await run(async () => { await Promise.all([accounts.load(), catalog.load()]); await capture.refresh() })
  if (!props.show) return
  const task = capture.task
  composing.value = !task || capture.imported || task.phase === "cancelled"
  introShown.value = !readIntroDismissed()
  draftStep.value = introShown.value ? "intro" : "target"
  showDetails.value = false
  ownerId.value = task?.ownerId && accounts.owners.some((owner: any) => owner.id === task.ownerId)
    ? task.ownerId : accounts.currentOwnerId ?? ""
  uid.value = task?.ownerId === ownerId.value ? task.declaredUid : capture.declaredUid(ownerId.value)
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
watch(() => capture.task?.id, () => { showDetails.value = false })
watch(() => [capture.task?.id, capture.task?.phase, capture.task?.errorCode], () => {
  const task = capture.task
  if (task && ["failed", "timed_out"].includes(task.phase) && captureFailureCategory(task.errorCode) === "decode") {
    decodeFailures.value = new Set([...decodeFailures.value, task.id])
  }
})
onBeforeUnmount(() => {
  if (polling) clearInterval(polling)
  if (props.show && capture.active) void capture.cancel().catch(() => {})
})
</script>

<template>
  <NModal :show="show" preset="card" title="抓包导入" class="capture-modal"
    style="width: min(720px, calc(100vw - 16px))" :mask-closable="false" :close-on-esc="false"
    :closable="!capture.busy" @update:show="close">
    <div class="capture-body ui-layout-scope" data-layout-surface="drive-capture" :data-capture-step="step">
      <ol v-if="stepGroup >= 0" class="capture-steps" aria-label="导入步骤">
        <li v-for="(label, index) in stepLabels" :key="label" :aria-current="index === stepGroup ? 'step' : undefined"
          :class="{ 'is-current': index === stepGroup, 'is-done': index < stepGroup }">{{ label }}</li>
      </ol>

      <template v-if="step === 'unavailable'">
        <h2 class="capture-title">抓包导入不可用</h2>
        <NAlert type="warning">当前环境没有可用的本机抓包导出器。请使用本机版计算器，或改用扫描助手。</NAlert>
      </template>

      <template v-else-if="step === 'intro'">
        <h2 class="capture-title">关于抓包导入</h2>
        <ol class="capture-intro">
          <li><strong>工作方式</strong><span>在游戏登录过程中读取本机收到的驱动盘数据。不修改游戏文件，数据仅保存在本机。</span></li>
          <li><strong>使用条件</strong><span>{{ capture.supportedClient }}；需授予一次 Windows 管理员权限，并重新登录游戏。</span></li>
          <li><strong>数据安全</strong><span>仅新增与更新，不删除已有驱动盘；配装、角色专属与排除设置保持不变。入库前可预览全部变化。已分解的驱动盘不会自动移除。</span></li>
        </ol>
        <NCheckbox v-model:checked="introDismissChecked">下次不再显示</NCheckbox>
      </template>

      <template v-else-if="step === 'target'">
        <h2 class="capture-title">选择目标账号</h2>
        <div class="ui-field-grid">
          <label data-layout-field>计算器账号
            <NSelect :value="ownerId" :options="options" aria-label="抓包目标计算器账号" @update:value="selectOwner" />
          </label>
          <label data-layout-field>游戏 UID（可留空）
            <NInput v-model:value="uid" placeholder="填写游戏 UID 或留空" aria-label="抓包声明 UID" />
          </label>
        </div>
        <p class="capture-hint">UID 仅用于区分账号，无法核验实际登录的游戏账号。留空时显示“未提供 UID”。</p>
        <NAlert v-if="uidInvalid" type="error">{{ uidInvalid }}</NAlert>
        <div v-else-if="mismatch" class="capture-mismatch" role="group" aria-label="UID 不一致">
          <strong>UID 与「{{ ownerLabel(ownerId) }}」的已有记录不一致</strong>
          <span>{{ mismatch }}</span>
          <button v-if="uidOwner" type="button" class="capture-choice" @click="selectOwner(uidOwner.id)">切换到「{{ uidOwner.label }}」</button>
          <button v-else type="button" class="capture-choice" @click="uid = capture.declaredUid(ownerId)">恢复已记录的 UID</button>
          <button type="button" class="capture-choice" :class="{ 'is-selected': acknowledgeMismatch }" :aria-pressed="acknowledgeMismatch"
            @click="acknowledgeMismatch = true">仍使用「{{ ownerLabel(ownerId) }}」，将声明 UID 改为 {{ normalizedUid }}（不影响 Enka 绑定）</button>
        </div>
      </template>

      <template v-else-if="step === 'prepare'">
        <p class="capture-target">{{ targetLine }}</p>
        <h2 class="capture-title">准备游戏</h2>
        <NCheckbox v-model:checked="gameAtLogin">游戏已停在登录页面</NCheckbox>
        <NCheckbox v-model:checked="noOtherCapture">未运行其他抓包工具</NCheckbox>
        <p class="capture-hint">开始后 Windows 将请求管理员授权，请选择“是”。在出现“请登录游戏”提示前，请勿登录。</p>
      </template>

      <template v-else-if="step === 'authorize'">
        <p class="capture-target">{{ targetLine }}</p>
        <div class="capture-center">
          <NSpin size="large" />
          <h2 class="capture-title">{{ capture.task.phase === 'awaiting_elevation' ? '请在 Windows 弹窗中允许授权' : '正在准备采集' }}</h2>
          <p>授权完成后请等待提示，再登录游戏。拒绝授权将结束本次任务。</p>
        </div>
      </template>

      <template v-else-if="step === 'login'">
        <p class="capture-target">{{ targetLine }}</p>
        <div class="capture-center" role="status" aria-live="polite">
          <h2 class="capture-title capture-title--large">请登录游戏</h2>
          <p>采集已就绪。登录后请保持库存不变，完成后将自动进入下一步。</p>
          <strong v-if="countdown" class="capture-countdown">{{ countdown }}</strong>
          <span class="capture-hint">请在 3 分钟内完成登录</span>
        </div>
      </template>

      <template v-else-if="step === 'working'">
        <p class="capture-target">{{ targetLine }}</p>
        <div class="capture-center" role="status" aria-live="polite">
          <NSpin size="large" />
          <h2 class="capture-title">{{ workingLabel }}</h2>
          <p>无需操作，请稍候。</p>
        </div>
      </template>

      <template v-else-if="step === 'second'">
        <p class="capture-target">{{ targetLine }}</p>
        <h2 class="capture-title">需要再次登录</h2>
        <p>首次读取的数据需要再次核对，并非错误。</p>
        <ol class="capture-list">
          <li>完全退出游戏，重新启动并停在登录页面。</li>
          <li>两次登录之间不要获取、分解、强化、穿戴、锁定或解锁驱动盘，也不要更换游戏版本。</li>
          <li>开始后，等再次出现“请登录游戏”提示时再登录。</li>
        </ol>
        <NCheckbox v-model:checked="secondConfirmed">同一游戏账号与版本，库存未变化，游戏已停在登录页面</NCheckbox>
      </template>

      <template v-else-if="step === 'review'">
        <p class="capture-target">{{ targetLine }}</p>
        <h2 class="capture-title">已读取 {{ capture.task.discCount }} 张驱动盘</h2>
        <p v-if="!preview">尚未入库。请先预览与本地库存的差异。</p>
        <template v-else>
          <div class="capture-numbers">
            <div><strong class="is-added">{{ preview.summary.added }}</strong><span>新增</span></div>
            <div><strong class="is-updated">{{ preview.summary.updated }}</strong><span>更新</span></div>
            <div><strong>{{ preview.summary.skipped }}</strong><span>无变化</span></div>
          </div>
          <div v-if="preview.summary.sourceMerged || preview.summary.conflicts" class="capture-tags">
            <NTag v-if="preview.summary.sourceMerged">合并来源 {{ preview.summary.sourceMerged }}</NTag>
            <NTag v-if="preview.summary.conflicts" type="warning">待确认 {{ preview.summary.conflicts }}</NTag>
          </div>
          <NAlert v-for="warning in preview.warnings" :key="warning" type="warning">{{ warning }}</NAlert>
          <DriveDiscConflictResolver :conflicts="capture.plan.conflicts" :resolutions="capture.draft.resolutions"
            :disabled="capture.busy || !!capture.ownerProblem" :meta="catalog.meta" @resolve="resolution => run(() => capture.resolve(resolution))" />
          <button v-if="changedRows.length" type="button" class="capture-link" :aria-expanded="showDetails" @click="showDetails = !showDetails">
            {{ showDetails ? '收起变化明细' : `查看变化明细（共 ${changedRows.length} 条）` }}
          </button>
          <div v-if="showDetails" class="capture-differences">
            <p v-if="changedRows.length > 30" class="capture-hint">仅展示前 30 条。</p>
            <article v-for="row in changedRows.slice(0, 30)" :key="row.key">
              <strong>{{ row.kind }} · {{ row.after.setName }} · {{ row.after.partition }} 号位</strong>
              <span v-if="row.before">原记录：等级 {{ row.before.level }}，{{ row.before.locked ? '游戏已锁定' : '游戏未锁定' }}，{{ statText(row.before.mainStat) }}；{{ row.before.subStats.map(statText).join('、') }}</span>
              <span>本次：等级 {{ row.after.level }}，{{ row.after.locked ? '游戏已锁定' : '游戏未锁定' }}，{{ statText(row.after.mainStat) }}；{{ row.after.subStats.map(statText).join('、') }}</span>
            </article>
          </div>
          <p class="capture-hint">仅新增与更新，不删除缺失的驱动盘；配装、角色专属、排除与穿戴关系保持不变。</p>
        </template>
      </template>

      <template v-else-if="step === 'done'">
        <div class="capture-center">
          <h2 class="capture-title">已导入本地库存</h2>
          <p v-if="capture.summary">新增 {{ capture.summary.added ?? 0 }}，更新 {{ capture.summary.updated ?? 0 }}。</p>
          <p class="capture-hint">再次导入相同驱动盘不会产生重复记录。</p>
        </div>
      </template>

      <template v-else-if="step === 'failed' && failure">
        <h2 class="capture-title">{{ failure.title }}</h2>
        <p>{{ failure.description }}</p>
        <p v-if="failure.detail" class="capture-hint">{{ failure.detail }}</p>
        <div class="capture-safe">本地库存未发生任何变化。</div>
        <p v-if="capture.task.processRunning" class="capture-hint">已发出取消，正在等待进程退出；如 Windows 授权窗口仍在，请关闭。</p>
        <div v-if="failure.code" class="capture-diagnostics">
          <span>错误码 {{ failure.code }}</span>
          <button type="button" class="capture-link" @click="copyDiagnostics">复制诊断信息</button>
        </div>
      </template>

      <NAlert v-if="capture.ownerProblem && step !== 'failed'" type="warning">{{ capture.ownerProblem }}</NAlert>
      <NButton v-if="capture.ownerProblem && step !== 'failed' && accounts.owners.some((owner: any) => owner.id === capture.task?.ownerId)"
        :disabled="capture.busy" @click="run(() => accounts.switchTo(capture.task.ownerId))">切回采集目标账号</NButton>
      <NAlert v-if="capture.notice" type="info">{{ capture.notice }}</NAlert>
      <NAlert v-if="capture.error" type="error" role="alert">{{ capture.error }}</NAlert>
    </div>
    <template #footer>
      <div class="capture-footer">
        <NButton v-if="step === 'target' && introShown" @click="draftStep = 'intro'">上一步</NButton>
        <NButton v-else-if="step === 'prepare'" @click="draftStep = 'target'">上一步</NButton>
        <NButton v-else-if="['authorize', 'login'].includes(step)" :disabled="capture.busy" @click="cancelTask">取消采集</NButton>
        <NButton v-else-if="step === 'review' && capture.plan" :disabled="capture.busy || !!capture.ownerProblem" @click="run(() => capture.preview())">重新预览</NButton>
        <NButton v-else-if="step === 'done'" @click="restart('target')">再次采集</NButton>
        <span class="capture-footer-spacer" />
        <NButton :disabled="capture.busy" @click="close">{{ capture.active ? '取消采集并关闭' : '关闭' }}</NButton>
        <NButton v-if="step === 'unavailable'" type="primary" @click="emit('use-scanner')">改用扫描助手</NButton>
        <NButton v-else-if="step === 'intro'" type="primary" @click="finishIntro">下一步</NButton>
        <NButton v-else-if="step === 'target'" type="primary" :disabled="!canLeaveTarget" @click="draftStep = 'prepare'">下一步</NButton>
        <NButton v-else-if="step === 'prepare'" type="primary" :disabled="!canStart" :loading="capture.busy" @click="start">
          {{ switchingAccount ? '切换到所选账号并开始采集' : '开始采集' }}
        </NButton>
        <NButton v-else-if="step === 'second'" type="primary" :disabled="!secondConfirmed || !!capture.ownerProblem || capture.busy"
          @click="run(() => capture.continueSecond())">开始第二轮采集</NButton>
        <NButton v-else-if="step === 'review' && !capture.plan" type="primary" :loading="capture.busy"
          :disabled="capture.busy || !!capture.ownerProblem" @click="run(() => capture.preview())">预览变化</NButton>
        <NButton v-else-if="step === 'review'" type="primary" :loading="capture.busy"
          :disabled="capture.busy || !!capture.ownerProblem || capture.plan.hasUnresolvedConflicts" @click="run(() => capture.confirm())">确认入库</NButton>
        <NButton v-else-if="step === 'done'" type="primary" @click="emit('update:show', false)">完成</NButton>
        <NButton v-else-if="step === 'failed' && failure" type="primary" :disabled="!!capture.task?.processRunning" @click="failurePrimary">{{ failure.primaryLabel }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.capture-body { display: grid; gap: 12px; min-width: 0; max-height: 65vh; overflow-y: auto; overflow-wrap: anywhere; }
.capture-body p { margin: 0; line-height: 1.6; }
.capture-body label { display: grid; gap: 6px; min-width: 0; }
.capture-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--app-text); }
.capture-title--large { font-size: 28px; }
.capture-hint, .capture-target { color: var(--app-muted); font-size: 12px; }
.capture-steps { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 4px; padding: 0; list-style: none; }
.capture-steps li {
  padding: 2px 10px; border-radius: 999px; background: var(--app-panel-muted); color: var(--app-muted); font-size: 12px;
}
.capture-steps li.is-done { color: var(--app-text-secondary); }
.capture-steps li.is-current { background: var(--app-blue-soft); color: var(--app-blue-strong); font-weight: 600; }
.capture-intro, .capture-list { display: grid; gap: 12px; margin: 0; padding-left: 20px; }
.capture-intro li { padding-left: 4px; }
.capture-intro strong { display: block; color: var(--app-text); }
.capture-intro span, .capture-list li { color: var(--app-text-secondary); font-size: 14px; line-height: 1.6; }
.capture-mismatch {
  display: grid; gap: 10px; padding: 14px 16px; border: 1px solid var(--app-amber-line);
  border-radius: var(--app-radius-lg); background: var(--app-amber-soft); color: var(--app-amber-strong);
}
.capture-choice {
  min-height: 44px; padding: 10px 14px; border: 1px solid var(--app-border-strong); border-radius: var(--app-radius);
  background: var(--app-panel); color: var(--app-text); font: inherit; text-align: left; cursor: pointer;
}
.capture-choice:hover { border-color: var(--app-blue); }
.capture-choice.is-selected { border: 2px solid var(--app-blue); color: var(--app-blue-strong); font-weight: 600; }
.capture-choice:focus-visible, .capture-link:focus-visible { outline: var(--app-focus-ring); }
.capture-center { display: grid; justify-items: center; gap: 12px; padding: 24px 0; text-align: center; }
.capture-countdown { color: var(--app-blue); font-size: 40px; font-weight: 600; font-variant-numeric: tabular-nums; }
.capture-numbers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@container (max-width: 360px) { .capture-numbers { grid-template-columns: minmax(0, 1fr); } }
.capture-numbers div { display: grid; gap: 2px; padding: 12px 14px; border-radius: var(--app-radius-lg); background: var(--app-panel-muted); }
.capture-numbers strong { font-size: 26px; color: var(--app-text); }
.capture-numbers strong.is-added { color: var(--app-green); }
.capture-numbers strong.is-updated { color: var(--app-blue); }
.capture-numbers span { color: var(--app-muted); font-size: 12px; }
.capture-tags, .capture-diagnostics { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.capture-diagnostics { color: var(--app-muted); font-size: 12px; }
.capture-link { justify-self: start; padding: 0; border: 0; background: none; color: var(--app-blue); font: inherit; font-size: 13px; cursor: pointer; }
.capture-safe { padding: 10px 14px; border-radius: var(--app-radius); background: var(--app-green-soft); color: var(--app-green-strong); font-size: 14px; }
.capture-differences { display: grid; gap: 8px; }
.capture-differences article { display: grid; gap: 6px; padding: 12px; background: var(--app-panel-muted); border-radius: 8px; }
.capture-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.capture-footer-spacer { flex: 1; }
.capture-body :deep(.n-button), .capture-footer :deep(.n-button) { height: auto; min-height: 34px; white-space: normal; }
.capture-body :deep(.n-button__content), .capture-footer :deep(.n-button__content) { white-space: normal; overflow-wrap: anywhere; }
</style>
