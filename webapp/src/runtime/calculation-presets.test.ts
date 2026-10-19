import { beforeEach, describe, expect, it } from "vitest"
import { saveCalculationPreset, calculationPresets, pinCalculationPreset, deleteCalculationPreset, validatePresetInventory } from "./calculation-presets"
import { saveUserDriveDiscStore, loadUserDriveDiscStoreFresh } from "./local-store.js"
import { createPersonalBackup } from "./personal-backup"
import { toCalculatorDriveDisc } from "@core/drive-disc-core.js"
const disc = { id: "disc-a", ownerId: "default", partition: 1, setId: "woodpecker_electro", level: 15, mainStat: { stat: "hpFlat", value: 2200 }, subStats: [{ stat: "critRate", value: 4.8 }] }
const config = { ownerId: "default", agentId: "miyabi", agentLevel: 60, wEngineId: "engine-a", discMode: "optimized", runtimeInputs: {}, targetConfig: { defense: 953 }, damageConfig: { events: [{ id: "event", count: 3, futureField: true }] }, buffPickerState: { teammateSlots: [{ agentId: "support" }, null] } }
const input = { agentId: "miyabi", driveDiscs: [disc], combatBuffs: { runtimeInputs: { "driveDisc4pc:test.self": { stacks: 2 } } }, damage: { events: [{ id: "event", count: 3 }] } }
beforeEach(async () => {
  localStorage.clear()
  await saveUserDriveDiscStore({ version: 1, currentOwnerId: "default", owners: [{ id: "default" }, { id: "alt" }], driveDiscs: [disc], imports: [], driveDiscLoadouts: [] })
})
describe("named calculation presets", () => {
  it("keeps independent complete snapshots per character and account", async () => {
    await saveCalculationPreset("失衡爆发", config, input)
    await saveCalculationPreset("日常输出", { ...config, agentLevel: 50 }, input)
    const group = calculationPresets("default", "miyabi")
    expect(group.entries).toHaveLength(2)
    expect(group.entries[0].config).toMatchObject({ agentLevel: 60, discMode: "manual", manualDriveDiscIdsBySlot: { 1: "disc-a" }, damageConfig: { ...input.damage, mode: "custom" }, buffPickerState: config.buffPickerState })
    expect(group.entries[0].config.runtimeInputs).toEqual(input.combatBuffs.runtimeInputs)
    expect(calculationPresets("default", "another").entries).toEqual([])
    expect(calculationPresets("alt", "miyabi").entries).toEqual([])
    group.entries[0].input.driveDiscs[0].level = 1
    expect(calculationPresets("default", "miyabi").entries[0].input.driveDiscs[0].level).toBe(15)
  })
  it("pins a saved snapshot, persists it, and clears the pin when deleted", async () => {
    const group = await saveCalculationPreset("A", config, input)
    const id = group.entries[0].id
    await pinCalculationPreset("default", "miyabi", id)
    expect(calculationPresets("default", "miyabi").pinnedId).toBe(id)
    await deleteCalculationPreset("default", "miyabi", id)
    expect(calculationPresets("default", "miyabi")).toEqual({ entries: [], pinnedId: "" })
    expect((await loadUserDriveDiscStoreFresh()).driveDiscs).toHaveLength(1)
  })
  it("rejects duplicate names and account switches", async () => {
    await saveCalculationPreset("A", config, input)
    await expect(saveCalculationPreset("A", config, input)).rejects.toThrow("同名")
    localStorage.setItem("zzz-calculator.currentAccount.v1", "alt")
    await expect(saveCalculationPreset("B", config, input)).rejects.toThrow("账号已切换")
  })
  it("blocks applying changed or missing discs but keeps their saved snapshots", async () => {
    const { entries } = await saveCalculationPreset("A", config, input)
    await expect(validatePresetInventory(entries[0])).resolves.toMatchObject({ agentId: "miyabi" })
    const store = await loadUserDriveDiscStoreFresh()
    store.driveDiscs[0].level = 12
    await saveUserDriveDiscStore(store)
    await expect(validatePresetInventory(entries[0])).rejects.toThrow("词条已变化")
    expect(calculationPresets("default", "miyabi").entries[0].input.driveDiscs[0].level).toBe(15)
  })
  it("compares normalized calculator stats with inventory stats containing explicit units", async () => {
    const store = await loadUserDriveDiscStoreFresh()
    store.driveDiscs[0].mainStat.mode = "flat"
    store.driveDiscs[0].subStats[0].mode = "pct"
    await saveUserDriveDiscStore(store)
    const { entries } = await saveCalculationPreset("A", config, { ...input, driveDiscs: [toCalculatorDriveDisc(store.driveDiscs[0])] })
    await expect(validatePresetInventory(entries[0])).resolves.toMatchObject({ agentId: "miyabi" })
    store.driveDiscs[0].subStats[0].value = 9.6
    await saveUserDriveDiscStore(store)
    await expect(validatePresetInventory(entries[0])).rejects.toThrow("词条已变化")
  })
  it("includes named snapshots and the pinned selection in a complete backup", async () => {
    await saveCalculationPreset("A", config, input)
    const backup = await createPersonalBackup()
    expect(backup.data.localStorage.some((record: any) => record.key === "zzz-calculator.calculation-presets.v1")).toBe(true)
  })
})
