import { readSafeJson } from "@runtime/storage-guard.js"
import { currentAccountId } from "@runtime/selection-storage.js"
import { withDriveDiscImportOwnerLock } from "@runtime/drive-disc-import-lock"
import { loadUserDriveDiscStoreFresh, driveDiscContentFingerprint } from "@runtime/local-store.js"
import { toCalculatorDriveDisc } from "@core/drive-disc-core.js"

export const CALCULATION_PRESETS_KEY = "zzz-calculator.calculation-presets.v1"
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function document() {
  const value = readSafeJson(CALCULATION_PRESETS_KEY, { version: 1, byOwner: {} })
  if (value?.version !== 1 || !value.byOwner || typeof value.byOwner !== "object") throw new Error("计算方案存档格式不受支持，已停止保存。")
  return value
}

export function calculationPresets(ownerId: string, agentId: string) {
  return clone(document().byOwner[ownerId]?.[agentId] ?? { entries: [], pinnedId: "" })
}

async function update(ownerId: string, agentId: string, action: (group: any) => any) {
  return withDriveDiscImportOwnerLock(ownerId, async () => {
    if (ownerId !== currentAccountId()) throw new Error("账号已切换，请重新打开方案列表。")
    const store = await loadUserDriveDiscStoreFresh()
    if (!store.owners.some((owner: any) => owner.id === ownerId)) throw new Error("方案所属账号已不存在。")
    const value = document()
    const group = action(clone(value.byOwner[ownerId]?.[agentId] ?? { entries: [], pinnedId: "" }))
    localStorage.setItem(CALCULATION_PRESETS_KEY, JSON.stringify({ ...value, byOwner: { ...value.byOwner,
      [ownerId]: { ...value.byOwner[ownerId], [agentId]: group } } }))
    return group
  })
}

export async function saveCalculationPreset(name: string, config: any, input: any) {
  const label = name.trim()
  if (!label || label.length > 80) throw new Error("请输入 1 至 80 个字的方案名称。")
  if (!config?.agentId || config.agentId !== input?.agentId || !Array.isArray(input.driveDiscs)) throw new Error("计算方案尚未准备好。")
  const snapshot = clone({ config, input })
  snapshot.config.discMode = "manual"
  snapshot.config.manualDriveDiscIdsBySlot = Object.fromEntries(input.driveDiscs.map((disc: any) => [String(disc.partition), disc.id]))
  snapshot.config.selectedLoadoutId = ""
  snapshot.config.selectedOptimizedRank = 0
  // Store the expanded events, so applying a snapshot does not adopt a later
  // administrator default or skill-group edit in place of the saved conditions.
  if (snapshot.input.damage) {
    const { target, ...damage } = snapshot.input.damage
    snapshot.config.damageConfig = { ...damage, mode: "custom" }
    if (target) snapshot.config.targetConfig = target
  }
  // Optimizer-selected four-piece trigger inputs are part of this exact build.
  snapshot.config.runtimeInputs = { ...snapshot.config.runtimeInputs, ...snapshot.input.combatBuffs?.runtimeInputs }
  return update(config.ownerId, config.agentId, group => {
    if (group.entries.some((entry: any) => entry.name === label)) throw new Error("此角色已有同名方案，请换一个名称。")
    group.entries.push({ id: globalThis.crypto.randomUUID(), name: label, createdAt: new Date().toISOString(), ...snapshot })
    return group
  })
}

export function pinCalculationPreset(ownerId: string, agentId: string, id: string) {
  return update(ownerId, agentId, group => {
    if (!group.entries.some((entry: any) => entry.id === id)) throw new Error("方案已删除，请刷新列表。")
    group.pinnedId = id
    return group
  })
}

export function deleteCalculationPreset(ownerId: string, agentId: string, id: string) {
  return update(ownerId, agentId, group => {
    group.entries = group.entries.filter((entry: any) => entry.id !== id)
    if (group.pinnedId === id) group.pinnedId = ""
    return group
  })
}

export async function validatePresetInventory(entry: any) {
  const store = await loadUserDriveDiscStoreFresh()
  if (store.currentOwnerId !== entry.config.ownerId || currentAccountId() !== entry.config.ownerId) throw new Error("账号已切换，请重新选择方案。")
  const actual = new Map(store.driveDiscs.filter((disc: any) => (disc.ownerId ?? "default") === entry.config.ownerId).map((disc: any) => [disc.id, disc]))
  for (const disc of entry.input.driveDiscs) {
    const live = actual.get(disc.id)
    if (!live || driveDiscContentFingerprint(toCalculatorDriveDisc(live)) !== driveDiscContentFingerprint(toCalculatorDriveDisc(disc))) {
      throw new Error("方案中的驱动盘已删除或词条已变化，无法原样应用。仍可固定为 A 查看保存时的快照。")
    }
  }
  return clone(entry.config)
}
