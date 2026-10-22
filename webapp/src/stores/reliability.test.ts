import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useOptimizerStore } from "./optimizer"
import { readBuildSelectionDocument, writeBuildSelectionDocument } from "@runtime/build-storage"
import { loadUserDriveDiscStoreFresh } from "@runtime/local-store.js"

beforeEach(() => {
  vi.stubGlobal("indexedDB", undefined)
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => { useOptimizerStore().disposeRuntime(); vi.unstubAllGlobals() })

describe("context and persistence safety", () => {
  it("retains malformed fallback inventory instead of treating it as empty", async () => {
    const raw = '{"driveDiscs": ['
    localStorage.setItem("zzz-calculator.userStore.v1", raw)
    await expect(loadUserDriveDiscStoreFresh()).rejects.toThrow("无法解析")
    expect(localStorage.getItem("zzz-calculator.userStore.v1")).toBe(raw)
  })

  it("keeps broken build and optimizer settings instead of replacing them with defaults", () => {
    localStorage.setItem("zzz-calculator.webapp.build.v1", "broken")
    expect(() => readBuildSelectionDocument()).toThrow("无法解析")
    expect(() => writeBuildSelectionDocument({ version: 2 })).toThrow("无法解析")
    expect(localStorage.getItem("zzz-calculator.webapp.build.v1")).toBe("broken")
    localStorage.setItem("zzz-calculator.webapp.optimizer.v1", "broken")
    expect(() => useOptimizerStore().initialize()).toThrow("无法解析")
    expect(localStorage.getItem("zzz-calculator.webapp.optimizer.v1")).toBe("broken")
  })
})
