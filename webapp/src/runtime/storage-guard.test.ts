import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import {
  exportUnreadableData,
  readSafeJson,
  storageIssues,
} from "./storage-guard.js"

beforeEach(() => {
  localStorage.clear()
  storageIssues.value = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("storage guard", () => {
  it("uses the fallback only when the key does not exist", () => {
    expect(readSafeJson("missing-key", { fallback: true })).toEqual({ fallback: true })
    expect(storageIssues.value).toEqual([])
  })

  it("records malformed JSON and keeps the original value", () => {
    const raw = "{broken"
    localStorage.setItem("broken-key", raw)

    expect(() => readSafeJson("broken-key", null)).toThrow("无法解析")
    expect(localStorage.getItem("broken-key")).toBe(raw)
    expect(storageIssues.value).toEqual([{ key: "broken-key", raw }])
  })

  it("exports every recorded unreadable value", () => {
    vi.useFakeTimers()
    localStorage.setItem("first-key", "{first")
    localStorage.setItem("second-key", "[second")
    for (const key of ["first-key", "second-key"]) {
      expect(() => readSafeJson(key, null)).toThrow()
    }

    let blobText = ""
    vi.stubGlobal("Blob", class {
      constructor(parts: unknown[]) {
        blobText = parts.join("")
      }
    })
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    exportUnreadableData()

    expect(JSON.parse(blobText).records).toEqual([
      { key: "first-key", raw: "{first" },
      { key: "second-key", raw: "[second" },
    ])
    vi.runAllTimers()
  })
})
