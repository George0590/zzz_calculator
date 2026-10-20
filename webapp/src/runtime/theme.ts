import { computed, ref, shallowRef, watchEffect } from "vue"
import type { GlobalTheme } from "naive-ui"

export type ThemePreference = "system" | "light" | "dark"

const THEME_KEY = "zzz-calculator.webapp.theme.v1"
const PREFERENCES: ThemePreference[] = ["system", "light", "dark"]

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return PREFERENCES.includes(saved as ThemePreference) ? saved as ThemePreference : "system"
  } catch {
    return "system"
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches
}

/** 跟随系统时去掉 data-theme，交给 CSS 媒体查询；手动选择时写入属性覆盖系统设置 */
export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (preference === "system") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", preference)
}

// 全站共用一份状态：顶栏切换后，Naive UI 主题和页面变量同时更新
const preference = ref<ThemePreference>(readPreference())
const systemDark = ref(systemPrefersDark())
const isDark = computed(() => preference.value === "dark" || (preference.value === "system" && systemDark.value))
let listening = false

// 深色主题按需加载，浅色模式的首屏不必下载
const naiveDarkTheme = shallowRef<GlobalTheme | null>(null)
let naiveDarkThemeLoading: Promise<void> | null = null

export function loadNaiveDarkTheme() {
  naiveDarkThemeLoading ??= import("./naive-dark-theme").then(
    module => { naiveDarkTheme.value = module.darkTheme },
    () => { naiveDarkThemeLoading = null },
  )
  return naiveDarkThemeLoading
}

function listenToSystemTheme() {
  if (listening || typeof window === "undefined" || typeof window.matchMedia !== "function") return
  listening = true
  const query = window.matchMedia("(prefers-color-scheme: dark)")
  const update = () => { systemDark.value = query.matches }
  if (typeof query.addEventListener === "function") query.addEventListener("change", update)
  else query.addListener?.(update)
}

/** 页面挂载前调用，尽量避免主题闪烁；返回值在深色模式下等深色主题加载完，挂载前等待它即可 */
export function initTheme(): Promise<void> {
  applyThemePreference(preference.value)
  listenToSystemTheme()
  return isDark.value ? loadNaiveDarkTheme() : Promise.resolve()
}

export function useTheme() {
  listenToSystemTheme()
  watchEffect(() => {
    if (isDark.value) void loadNaiveDarkTheme()
  })
  /** 交给 NConfigProvider 的主题；深色主题还在下载时暂时为 null */
  const naiveTheme = computed(() => isDark.value ? naiveDarkTheme.value : null)
  function setPreference(next: ThemePreference) {
    preference.value = next
    applyThemePreference(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* 存不下时只在本次生效 */ }
  }
  /** 跟随系统 → 浅色 → 深色 → 跟随系统 */
  function cyclePreference() {
    setPreference(PREFERENCES[(PREFERENCES.indexOf(preference.value) + 1) % PREFERENCES.length]!)
  }
  return { preference, isDark, naiveTheme, setPreference, cyclePreference }
}
