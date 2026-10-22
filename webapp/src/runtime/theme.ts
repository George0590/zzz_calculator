import { computed, readonly, ref } from "vue"
import { darkTheme } from "naive-ui"
import { darkThemeOverrides, lightThemeOverrides } from "./theme-overrides"

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

// 页面生命周期共用一份状态和一次系统监听；组件使用时不创建额外副作用。
const preference = ref<ThemePreference>(readPreference())
const systemDark = ref(false)
const isDark = computed(() => preference.value === "dark" || (preference.value === "system" && systemDark.value))
const naiveTheme = computed(() => isDark.value ? darkTheme : null)
const themeOverrides = computed(() => isDark.value ? darkThemeOverrides : lightThemeOverrides)
let initialized = false

function applyPreference() {
  if (typeof document === "undefined") return
  if (preference.value === "system") document.documentElement.removeAttribute("data-theme")
  else document.documentElement.setAttribute("data-theme", preference.value)
}

/** 挂载前同步恢复；首次加载脚本前的浏览器绘制不在此函数控制范围内。 */
export function initTheme() {
  if (!initialized && typeof window !== "undefined") {
    initialized = true
    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia("(prefers-color-scheme: dark)")
      const update = () => { systemDark.value = query.matches }
      update()
      if (typeof query.addEventListener === "function") query.addEventListener("change", update)
      else query.addListener?.(update)
    }
  }
  applyPreference()
}

function setPreference(next: ThemePreference) {
  preference.value = next
  applyPreference()
  try { localStorage.setItem(THEME_KEY, next) } catch { /* 存储不可用时，本次会话仍可切换。 */ }
}

function cyclePreference() {
  setPreference(PREFERENCES[(PREFERENCES.indexOf(preference.value) + 1) % PREFERENCES.length]!)
}

export function useTheme() {
  initTheme()
  return { preference: readonly(preference), isDark, naiveTheme, themeOverrides, setPreference, cyclePreference }
}
