import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { CAPTURE_ERROR_DETAILS, CAPTURE_FAILURE_CODES, captureFailureCategory, captureFailureGuide } from "./drive-capture-failures"

const backendCodes = [...readFileSync(resolve(process.cwd(), "../backend/driveCapture.js"), "utf8")
  .matchAll(/fail\("([A-Z_]+)"/g)].map(match => match[1])

describe("capture failure categories", () => {
  it("assigns every error code to exactly one category with a detail line", () => {
    const all = Object.values(CAPTURE_FAILURE_CODES).flat()
    expect(all).toHaveLength(22)
    expect(new Set(all).size).toBe(all.length)
    expect(Object.keys(CAPTURE_ERROR_DETAILS).sort()).toEqual([...all].sort())
  })

  it("covers every failure code the local service can emit", () => {
    expect(backendCodes.length).toBeGreaterThan(0)
    for (const code of backendCodes) expect(Object.values(CAPTURE_FAILURE_CODES).flat()).toContain(code)
  })

  it("routes unsupported cases to the scanner and repeated decode failures too", () => {
    expect(captureFailureGuide("VERSION_MAPPING").primaryAction).toBe("scan")
    expect(captureFailureGuide("DECODE_FAILED", 1).primaryAction).toBe("restart")
    expect(captureFailureGuide("DECODE_FAILED", 2).primaryAction).toBe("scan")
    expect(captureFailureCategory("UNKNOWN_CODE")).toBe("retry")
  })
})
