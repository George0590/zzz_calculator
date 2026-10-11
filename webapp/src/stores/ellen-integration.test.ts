import { createPinia, setActivePinia } from "pinia"
import { beforeEach, expect, it } from "vitest"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { buildMeta, loadCalculatorContext } from "../../../backend/calculator.js"
import { useBuildStore } from "./build"

const catalog = await loadCalculatorContext(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."))
const meta = buildMeta(catalog)

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

it("initializes Ellen's reference team without teammate equipment", () => {
  const store = useBuildStore()
  store.applyAgentConfig("ellen_joe", meta, {})
  expect(store.potentialLevel).toBe(6)
  expect(store.buffPickerState?.teammateSlots.map(slot => slot?.teammateId)).toEqual(["liuyin", "qianxia"])
  for (const owner of ["liuyin", "qianxia"]) {
    const core = meta.teammateCombatBuffGroups.find((group: any) => group.id === owner)
      .buffs.find((buff: any) => buff.sourceLabel?.zhCN === "核心被动")
    expect(store.selectedBuffIds).toContain(core.id)
  }
  expect(store.selectedBuffIds.some(id => id.includes("cinema_"))).toBe(false)
  expect(store.selectedBuffIds.some(id => id.startsWith("wEngine:") || id.startsWith("teammateDriveDisc4pc:"))).toBe(false)
})

it.each([
  { selectedBuffIds: [] },
  { combat: { activeBuffIds: [] } },
  { buffPickerState: { teammateSlots: [null, null] } },
])("does not replace explicitly saved empty selections: %j", config => {
  const store = useBuildStore()
  store.applyAgentConfig("ellen_joe", meta, config)
  expect(store.selectedBuffIds).toEqual([])
  expect(store.buffPickerState?.teammateSlots.filter(Boolean) ?? []).toEqual([])
})

it("preserves a cleared team and unchecked own Buff after reload", async () => {
  const store = useBuildStore()
  store.applyAgentConfig("ellen_joe", meta, {})
  store.buffPickerState = { teammateSlots: [null, null] }
  store.selectedBuffIds = []
  store.manuallyUncheckedDefaultBuffIds = ["agent:ellen_joe.additionalAbility"]
  await store.persist()
  setActivePinia(createPinia())
  const restored = useBuildStore()
  restored.initialize({}, meta)
  expect(restored.agentId).toBe("ellen_joe")
  expect(restored.buffPickerState?.teammateSlots).toEqual([null, null])
  expect(restored.selectedBuffIds).toEqual([])
  expect(restored.manuallyUncheckedDefaultBuffIds).toContain("agent:ellen_joe.additionalAbility")
})

it("keeps an existing team and chosen cinema", () => {
  const store = useBuildStore()
  const picker = { teammateSlots: [{ teammateId: "qianxia", cinemaLevel: 2 }, null] }
  store.applyAgentConfig("ellen_joe", meta, { buffPickerState: picker, selectedBuffIds: [] })
  expect(store.buffPickerState).toEqual(picker)
  expect(store.selectedBuffIds).toEqual([])
})
