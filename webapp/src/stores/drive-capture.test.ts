import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useDriveCaptureStore } from "./drive-capture"
import { useAccountStore } from "./account"
import { useCatalogStore } from "./catalog"
import { useInventoryStore } from "./inventory"
import { loadUserDriveDiscStoreFresh, saveUserDriveDiscStore } from "@runtime/local-store.js"
import fixture from "../../../tests/fixtures/drive-capture-v1.json"

let task: any
let requests: any[]
const base = () => ({ version: 1, currentOwnerId: "default", owners: [{ id: "default", label: "主账号" }, { id: "alt", label: "小号" }], driveDiscs: [], driveDiscLoadouts: [], imports: [] })
const copy = (value: any) => JSON.parse(JSON.stringify(value))

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await saveUserDriveDiscStore(base())
  await useAccountStore().load()
  useCatalogStore().catalog = { driveDiscSets: [{ id: "woodpecker_electro" }] } as any
  requests = []
  task = { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", ownerId: "default", ownerLabel: "主账号", declaredUid: "", uidSkipped: true, phase: "ready", discCount: 1, round: 1 }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    requests.push({ url, init })
    if (init?.method === "POST" && url === "/api/drive-capture") task = { ...task, ...JSON.parse(init.body), phase: "waiting_login" }
    return { ok: true, json: async () => ({ ok: true, available: true, task: copy(task), payload: copy(fixture) }) }
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe("capture browser import transaction", () => {
  it("skips UID and freezes the selected owner", async () => {
    const store = useDriveCaptureStore()
    await store.start("alt", "")
    expect(store.task.ownerId).toBe("alt")
    expect(store.task.declaredUid).toBe("")
    expect(requests[0].init.headers["X-ZZZ-Local-Request"]).toBe("1")
    await useAccountStore().switchTo("default")
    expect(store.task.ownerId).toBe("alt")
    expect(store.ownerProblem).toContain("切换")
  })
  it("requires acknowledgement of a different declared UID", async () => {
    const store = useDriveCaptureStore()
    localStorage.setItem("zzz-calculator.capture-uid.v1", JSON.stringify({ default: "1234" }))
    await expect(store.start("default", "5678")).rejects.toThrow("不同")
    expect(requests).toHaveLength(0)
    await store.start("default", "5678", true)
    expect(store.declaredUid("default")).toBe("5678")
    expect(store.task.verifiedUid).toBeUndefined()
  })
  it("commits, reads back on refresh and does not duplicate after adding a UID", async () => {
    const store = useDriveCaptureStore()
    await store.refresh(); await store.preview()
    expect(store.plan.preview.summary.added).toBe(1)
    expect(store.draft.options.removeMissing).toBe(false)
    expect(store.plan.requireCurrentOwner).toBe(true)
    await store.confirm()
    expect(store.imported).toBe(true)
    expect((await loadUserDriveDiscStoreFresh()).driveDiscs).toHaveLength(1)
    store.importedTaskId = ""
    await store.refresh()
    expect(store.imported).toBe(true)
    task = { ...task, id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", declaredUid: "123456789" }
    await store.refresh(); await store.preview()
    expect(store.plan.preview.summary.added).toBe(0)
    await store.confirm()
    expect((await loadUserDriveDiscStoreFresh()).driveDiscs).toHaveLength(1)
  })
  it("blocks switched/deleted owners before and after preview", async () => {
    const store = useDriveCaptureStore()
    await store.refresh()
    await useAccountStore().switchTo("alt")
    await expect(store.preview()).rejects.toThrow("切回")
    await useAccountStore().switchTo("default")
    await store.preview()
    await useAccountStore().switchTo("alt")
    await expect(store.confirm()).rejects.toThrow("切回")
    expect((await loadUserDriveDiscStoreFresh()).driveDiscs).toHaveLength(0)
    await useAccountStore().remove("default")
    await expect(store.preview()).rejects.toThrow("删除")
  })
  it("invalidates a stale preview without discarding the capture", async () => {
    const store = useDriveCaptureStore()
    await store.refresh(); await store.preview()
    const current = await loadUserDriveDiscStoreFresh()
    current.driveDiscs.push({ ...copy(fixture.driveDiscs[0]), id: "unrelated-disc", ownerId: "default", level: 12 })
    await saveUserDriveDiscStore(current)
    await expect(store.confirm()).rejects.toThrow("变化")
    expect(store.plan).toBeNull()
    expect(store.task.phase).toBe("ready")
    expect(store.imported).toBe(false)
  })
  it("retains the capture and never claims success after a commit failure", async () => {
    const store = useDriveCaptureStore()
    await store.refresh(); await store.preview()
    vi.spyOn(useInventoryStore(), "commitFrozenImport").mockRejectedValueOnce(new Error("disk full"))
    await expect(store.confirm()).rejects.toThrow("disk full")
    expect(store.imported).toBe(false)
    expect(store.task.phase).toBe("ready")
    expect((await loadUserDriveDiscStoreFresh()).driveDiscs).toHaveLength(0)
  })
  it("rejects a result for another frozen owner", async () => {
    const store = useDriveCaptureStore()
    await store.refresh()
    task.ownerId = "alt"
    await expect(store.preview()).rejects.toThrow("不一致")
    expect(store.plan).toBeNull()
  })
})
