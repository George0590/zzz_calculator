import { defineStore } from "pinia"
import { assertCaptureOwner, normalizeDeclaredUid, validateCaptureExport } from "@core/drive-disc-capture.js"
import { loadUserDriveDiscStoreFresh } from "@runtime/local-store.js"
import { useInventoryStore } from "./inventory"
import { useCatalogStore } from "./catalog"
import { useAccountStore } from "./account"

const UID_KEY = "zzz-calculator.capture-uid.v1"
const TERMINAL = ["ready", "failed", "cancelled", "timed_out"]

export async function captureRequest(suffix = "", body?: any) {
  const response = await fetch(`/api/drive-capture${suffix}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-ZZZ-Local-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error ?? "无法连接本机采集服务。")
  return data
}

function declarations(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(UID_KEY) ?? "{}") } catch { return {} }
}

export const useDriveCaptureStore = defineStore("drive-capture", {
  state: () => ({
    available: false, supportedClient: "国服正式 Windows PC · CNPRODWin3.2.0", loaded: false,
    task: null as any, busy: false, error: "", notice: "", draft: null as any, plan: null as any,
    importedTaskId: "", summary: null as any,
  }),
  getters: {
    active: state => Boolean(state.task && (!TERMINAL.includes(state.task.phase) || state.task.processRunning)),
    ownerProblem: state => {
      if (!state.task) return ""
      const accounts = useAccountStore()
      if (!accounts.owners.some((owner: any) => owner.id === state.task.ownerId)) return "目标账号已删除，结果已保留，不能导入其他账号。"
      return accounts.currentOwnerId === state.task.ownerId ? "" : "当前账号已切换，请切回采集目标账号后重新预览。"
    },
    imported: state => Boolean(state.task && state.importedTaskId === state.task.id),
  },
  actions: {
    declaredUid(ownerId: string) { return String(declarations()[ownerId] ?? "") },
    async uidMismatch(ownerId: string, value: string) {
      const uid = normalizeDeclaredUid(value)
      if (!uid) return ""
      const store = await loadUserDriveDiscStoreFresh()
      const enkaUid = String(store.enkaImportState?.byOwner?.[ownerId]?.binding?.uid ?? "")
      const previous = this.declaredUid(ownerId)
      if ((previous && previous !== uid) || (enkaUid && enkaUid !== uid)) {
        return `本次 UID 与该计算器账号已有记录不同（声明：${previous || "无"}；Enka 绑定：${enkaUid || "无"}）。请选对账号，或明确确认调整本次声明。`
      }
      return ""
    },
    async refresh() {
      const response = await captureRequest()
      if (this.task?.id !== response.task?.id) { this.draft = null; this.plan = null; this.summary = null }
      this.available = response.available
      this.supportedClient = response.supportedClient
      this.task = response.task
      this.loaded = true
      if (response.error) this.notice = response.error
      if (this.task?.phase === "ready") {
        const store = await loadUserDriveDiscStoreFresh()
        const imported = store.imports?.find((entry: any) => entry.ownerId === this.task.ownerId && entry.sourcePath === `drive-capture:${this.task.id}`)
        if (imported) this.importedTaskId = this.task.id
      }
    },
    async start(ownerId: string, value: string, acknowledgeMismatch = false) {
      if (this.busy || this.active) return
      this.busy = true
      this.error = ""
      try {
        const declaredUid = normalizeDeclaredUid(value)
        const mismatch = await this.uidMismatch(ownerId, declaredUid)
        if (mismatch && !acknowledgeMismatch) throw new Error(mismatch)
        const accounts = useAccountStore()
        if (accounts.currentOwnerId !== ownerId) await accounts.switchTo(ownerId)
        const store = await loadUserDriveDiscStoreFresh()
        assertCaptureOwner(store, ownerId)
        const owner = store.owners.find((entry: any) => entry.id === ownerId)
        const response = await captureRequest("", { ownerId, ownerLabel: owner.label, declaredUid })
        this.task = response.task
        this.draft = null
        this.plan = null
        this.summary = null
        this.notice = ""
        if (declaredUid) {
          try { localStorage.setItem(UID_KEY, JSON.stringify({ ...declarations(), [ownerId]: declaredUid })) }
          catch { this.notice = "本次 UID 已记录在采集任务中，但未能保存为下次默认值。" }
        }
      } catch (error: any) { this.error = error.message; throw error }
      finally { this.busy = false }
    },
    async cancel() {
      if (!this.task || this.busy) return
      this.task = (await captureRequest(`/${this.task.id}/cancel`, {})).task
    },
    async continueSecond() {
      if (!this.task || this.busy) return
      this.busy = true
      try {
        assertCaptureOwner(await loadUserDriveDiscStoreFresh(), this.task.ownerId)
        this.task = (await captureRequest(`/${this.task.id}/continue`, {})).task
      } finally { this.busy = false }
    },
    async preview() {
      if (this.busy || this.task?.phase !== "ready") return
      this.busy = true
      this.error = ""
      this.plan = null
      try {
        const task = { ...this.task }
        assertCaptureOwner(await loadUserDriveDiscStoreFresh(), task.ownerId)
        const response = await captureRequest(`/${task.id}/result`)
        if (response.task.id !== task.id || response.task.ownerId !== task.ownerId) throw new Error("结果与被冻结的采集目标不一致。")
        validateCaptureExport(response.payload, { driveDiscSets: useCatalogStore().driveDiscSets, expectedCount: task.discCount })
        const inventory = useInventoryStore()
        const draft = inventory.createImportDraft(response.payload, false, `drive-capture:${task.id}`, null, task.ownerId)
        Object.assign(draft.options, { captureImport: true })
        const plan = await inventory.createFrozenImportPlan(draft)
        assertCaptureOwner(await loadUserDriveDiscStoreFresh(), task.ownerId)
        if (this.task.id !== task.id) throw new Error("采集任务已改变，请重新预览。")
        this.draft = draft
        this.plan = plan
      } catch (error: any) { this.error = error.message; throw error }
      finally { this.busy = false }
    },
    async resolve(resolution: any) {
      if (this.busy || !this.draft) return
      this.busy = true
      try {
        assertCaptureOwner(await loadUserDriveDiscStoreFresh(), this.task.ownerId)
        const draft = { ...this.draft, resolutions: { ...this.draft.resolutions, [resolution.key]: resolution.action === "update"
          ? { action: "update", existingId: resolution.existingId } : { action: "add" } } }
        const plan = await useInventoryStore().createFrozenImportPlan(draft)
        assertCaptureOwner(await loadUserDriveDiscStoreFresh(), this.task.ownerId)
        this.draft = draft
        this.plan = plan
      } finally { this.busy = false }
    },
    async confirm() {
      if (this.busy || !this.plan) return
      this.busy = true
      this.error = ""
      let committed = false
      try {
        assertCaptureOwner(await loadUserDriveDiscStoreFresh(), this.task.ownerId)
        if (this.plan.ownerId !== this.task.ownerId || this.plan.hasUnresolvedConflicts) throw new Error("请先完成目标账号的差异预览和冲突确认。")
        this.summary = await useInventoryStore().commitFrozenImport(this.plan)
        committed = true
        const persisted = await loadUserDriveDiscStoreFresh()
        if (!persisted.imports?.some((entry: any) => entry.id === this.draft.options.importId && entry.ownerId === this.task.ownerId)) {
          throw new Error("未能回读本次入库记录。")
        }
        this.importedTaskId = this.task.id
        this.plan = null
        this.draft = null
        await useAccountStore().load().catch(() => { this.notice = "库存已保存并回读成功，但账号摘要刷新失败，请刷新页面。" })
      } catch (error: any) {
        this.error = `${committed ? "库存已提交，但回读未完成，请刷新确认" : "库存提交失败"}：${error.message}`
        this.plan = null
        throw new Error(this.error)
      }
      finally { this.busy = false }
    },
    invalidatePreview() { this.plan = null; this.draft = null },
  },
})
