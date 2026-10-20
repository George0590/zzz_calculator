import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import DriveImportEntry from "@/components/DriveImportEntry.vue"

function mockService(available: boolean | Error) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (available instanceof Error) throw available
    return { ok: true, json: async () => ({ ok: true, available, task: null, supportedClient: "国服正式 Windows PC" }) }
  }))
}

async function mountEntry(props: Record<string, unknown> = {}) {
  const wrapper = mount(DriveImportEntry, { props, global: { plugins: [createPinia()] } })
  await flushPromises()
  return wrapper
}

const button = (wrapper: any, label: string) => wrapper.findAll("button").find((item: any) => item.text().trim() === label)

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

describe("DriveImportEntry", () => {
  it("offers capture and scanner as two equal choices with capture recommended", async () => {
    mockService(true)
    const wrapper = await mountEntry({ enkaEnabled: true })

    expect(wrapper.get('[data-testid="import-entry-capture"]').text()).toContain("推荐")
    expect(wrapper.get('[data-testid="import-entry-scan"]').text()).not.toContain("推荐")
    expect(button(wrapper, "开始抓包").attributes("disabled")).toBeUndefined()
    for (const [label, event] of [["开始抓包", "capture"], ["使用扫描助手", "scan"], ["导入 JSON 文件", "json"], ["Enka 展柜（仅展柜角色）", "enka"]]) {
      await button(wrapper, label).trigger("click")
      expect(wrapper.emitted(event)).toHaveLength(1)
    }
  })

  it("disables capture with a reason when the local service is unavailable", async () => {
    mockService(new Error("offline"))
    const wrapper = await mountEntry()

    expect(button(wrapper, "开始抓包").attributes("disabled")).toBeDefined()
    expect(wrapper.text()).toContain("当前环境不可用")
    expect(button(wrapper, "使用扫描助手").attributes("disabled")).toBeUndefined()
    expect(wrapper.text()).not.toContain("Enka")
  })
})
