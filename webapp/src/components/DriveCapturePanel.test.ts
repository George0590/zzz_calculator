import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import DriveCapturePanel from "@/components/DriveCapturePanel.vue"
import { useAccountStore } from "@/stores/account"
import { useCatalogStore } from "@/stores/catalog"
import { saveUserDriveDiscStore } from "@runtime/local-store.js"

vi.mock("naive-ui", async original => ({
  ...(await original<typeof import("naive-ui")>()),
  NModal: { props: ["show"], template: "<div v-if=\"show\" class=\"modal-stub\"><slot /><slot name=\"footer\" /></div>" },
}))

let task: any
const base = () => ({ version: 1, currentOwnerId: "default", owners: [{ id: "default", label: "主账号" }, { id: "alt", label: "小号" }], driveDiscs: [], driveDiscLoadouts: [], imports: [] })

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await saveUserDriveDiscStore(base())
  await useAccountStore().load()
  useCatalogStore().loaded = true as any
  task = null
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    if (init?.method === "POST" && url === "/api/drive-capture") {
      task = { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", ...JSON.parse(init.body), phase: "awaiting_elevation", round: 1, phaseAt: Date.now() }
    }
    return { ok: true, json: async () => ({ ok: true, available: true, supportedClient: "国服正式 Windows PC", task }) }
  }))
  vi.spyOn(useCatalogStore(), "load").mockResolvedValue(undefined as any)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

async function mountPanel() {
  const wrapper = mount(DriveCapturePanel, { props: { show: true } })
  await flushPromises()
  return wrapper
}
const stepOf = (wrapper: any) => wrapper.get("[data-capture-step]").attributes("data-capture-step")
const button = (wrapper: any, label: string) => {
  const match = wrapper.findAll("button").find((item: any) => item.text().trim() === label)
  if (!match) throw new Error(`Button not found: ${label}`)
  return match
}

describe("DriveCapturePanel wizard", () => {
  it("shows the introduction once and skips it after it is dismissed", async () => {
    const first = await mountPanel()
    expect(stepOf(first)).toBe("intro")
    await first.get(".n-checkbox").trigger("click")
    await button(first, "下一步").trigger("click")
    expect(stepOf(first)).toBe("target")
    first.unmount()

    const second = await mountPanel()
    expect(stepOf(second)).toBe("target")
    second.unmount()
  })

  it("resolves a UID mismatch with two explicit choices instead of a checkbox", async () => {
    localStorage.setItem("zzz-calculator.capture-intro-dismissed.v1", "1")
    localStorage.setItem("zzz-calculator.capture-uid.v1", JSON.stringify({ default: "1234", alt: "5678" }))
    const wrapper = await mountPanel()
    await wrapper.get(".n-input input").setValue("5678")
    await flushPromises()

    const group = wrapper.get('[aria-label="UID 不一致"]')
    expect(group.find(".n-checkbox").exists()).toBe(false)
    expect(button(wrapper, "下一步").attributes("disabled")).toBeDefined()
    expect(group.text()).toContain("切换到「小号」")
    await button(wrapper, "仍使用「主账号」，将声明 UID 改为 5678（不影响 Enka 绑定）").trigger("click")
    expect(button(wrapper, "下一步").attributes("disabled")).toBeUndefined()
    wrapper.unmount()
  })

  it("requires both preparation checks before starting and then follows the task phase", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.setItem("zzz-calculator.capture-intro-dismissed.v1", "1")
    const wrapper = await mountPanel()
    await button(wrapper, "下一步").trigger("click")
    expect(stepOf(wrapper)).toBe("prepare")
    expect(button(wrapper, "开始采集").attributes("disabled")).toBeDefined()
    for (const box of wrapper.findAll(".n-checkbox")) await box.trigger("click")
    await button(wrapper, "开始采集").trigger("click")
    await flushPromises()
    expect(stepOf(wrapper)).toBe("authorize")

    task = { ...task, phase: "waiting_login", phaseAt: Date.now() - 30_000 }
    await vi.advanceTimersByTimeAsync(1100)
    await flushPromises()
    expect(stepOf(wrapper)).toBe("login")
    expect(wrapper.text()).toContain("请登录游戏")
    expect(wrapper.text()).toMatch(/2:(29|30)/)

    task = { ...task, phase: "needs_second_login" }
    await vi.advanceTimersByTimeAsync(1100)
    await flushPromises()
    expect(stepOf(wrapper)).toBe("second")
    expect(button(wrapper, "开始第二轮采集").attributes("disabled")).toBeDefined()
    wrapper.unmount()
  })

  it.each([
    ["VERSION_MAPPING", "改用扫描助手", true],
    ["UAC_REJECTED", "重新开始", false],
  ])("offers one next step for %s and states the inventory is unchanged", async (code, label, scanner) => {
    task = { id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", ownerId: "default", ownerLabel: "主账号", declaredUid: "", phase: "failed", errorCode: code, round: 1 }
    const wrapper = await mountPanel()
    expect(stepOf(wrapper)).toBe("failed")
    expect(wrapper.text()).toContain("本地库存未发生任何变化")
    expect(wrapper.text()).toContain(`错误码 ${code}`)
    await button(wrapper, label).trigger("click")
    if (scanner) expect(wrapper.emitted("use-scanner")).toHaveLength(1)
    else expect(stepOf(wrapper)).toBe("prepare")
    wrapper.unmount()
  })
})
