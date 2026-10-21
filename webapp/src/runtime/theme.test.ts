import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/runtime/naive-dark-theme", () => ({ darkTheme: { name: "dark" } }))

const THEME_KEY = "zzz-calculator.webapp.theme.v1"

function stubMatchMedia(dark: boolean) {
  const listeners: Array<() => void> = []
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  }
  vi.stubGlobal("matchMedia", vi.fn(() => query))
  return {
    setDark(value: boolean) {
      query.matches = value
      for (const listener of listeners) listener()
    },
  }
}

// 主题状态是模块级单例，每个用例重新加载模块
async function loadTheme() {
  vi.resetModules()
  return import("@/runtime/theme")
}

describe("theme preference", () => {
  beforeEach(() => {
    localStorage.removeItem(THEME_KEY)
    document.documentElement.removeAttribute("data-theme")
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it("follows the system by default without forcing a data-theme attribute", async () => {
    const media = stubMatchMedia(false)
    const { initTheme, useTheme } = await loadTheme()
    initTheme()
    const { preference, isDark } = useTheme()
    expect(preference.value).toBe("system")
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
    expect(isDark.value).toBe(false)
    media.setDark(true)
    expect(isDark.value).toBe(true)
  })

  it("cycles system → light → dark → system, applies the attribute, and remembers the choice", async () => {
    stubMatchMedia(true)
    const { useTheme } = await loadTheme()
    const { preference, isDark, cyclePreference } = useTheme()

    cyclePreference()
    expect(preference.value).toBe("light")
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
    expect(isDark.value).toBe(false)
    expect(localStorage.getItem(THEME_KEY)).toBe("light")

    cyclePreference()
    expect(preference.value).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(isDark.value).toBe(true)

    cyclePreference()
    expect(preference.value).toBe("system")
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("restores a saved explicit choice before mounting and ignores invalid values", async () => {
    stubMatchMedia(false)
    localStorage.setItem(THEME_KEY, "dark")
    let theme = await loadTheme()
    theme.initTheme()
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(theme.useTheme().isDark.value).toBe(true)

    localStorage.setItem(THEME_KEY, "neon")
    document.documentElement.removeAttribute("data-theme")
    theme = await loadTheme()
    theme.initTheme()
    expect(theme.useTheme().preference.value).toBe("system")
  })

  it("loads the Naive UI dark theme only when dark mode is active", async () => {
    const media = stubMatchMedia(false)
    const { initTheme, useTheme } = await loadTheme()
    await initTheme()
    const { naiveTheme } = useTheme()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(naiveTheme.value).toBeNull()

    media.setDark(true)
    await vi.waitFor(() => expect(naiveTheme.value).toEqual({ name: "dark" }))
  })

  it("has the dark theme ready before mount when starting in dark mode", async () => {
    stubMatchMedia(false)
    localStorage.setItem(THEME_KEY, "dark")
    const { initTheme, useTheme } = await loadTheme()
    await initTheme()
    expect(useTheme().naiveTheme.value).toEqual({ name: "dark" })
  })
})
