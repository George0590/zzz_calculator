<script setup lang="ts">
import { computed } from "vue"
import { NAlert, NConfigProvider, NMessageProvider, type GlobalThemeOverrides } from "naive-ui"
import { Calculator, Database, Download, HardDrive, Settings2, UserRound } from "lucide-vue-next"
import { useRoute } from "vue-router"
import { useAccountStore } from "@/stores/account"
import { useAppConfigStore } from "@/stores/app-config"
import { useTheme } from "@/runtime/theme"

const accountStore = useAccountStore()
const appConfigStore = useAppConfigStore()
const route = useRoute()
const props = defineProps<{ startupError?: string }>()
const maintenanceEnabled = computed(() => appConfigStore.config.maintenanceEnabled)
const enkaImportEnabled = computed(() => appConfigStore.config.enkaImportEnabled)
const enkaImportDisabledNotice = computed(() => route.query.notice === "enka-import-disabled")

const currentAccountLabel = computed(() => accountStore.currentOwnerLabel)
const accountChipText = computed(() => {
  if (accountStore.loadState === "error") return "账号加载失败"
  if (currentAccountLabel.value) return `账号 / ${currentAccountLabel.value}`
  return "账号加载中"
})

const { isDark, naiveTheme } = useTheme()

const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#2f7df6",
    primaryColorHover: "#1f6fe6",
    primaryColorPressed: "#185abd",
    borderRadius: "6px",
    textColorBase: "#0f172a",
    textColor1: "#0f172a",
    textColor2: "#334155",
    textColor3: "#5b6577",
    fontFamily: "system-ui, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif",
  },
  Card: {
    borderRadius: "8px",
  },
  Alert: {
    borderRadius: "8px",
    padding: "10px 12px",
    titleFontWeight: "700",
    colorInfo: "#edf4ff",
    borderInfo: "1px solid #bcd4fb",
    colorSuccess: "#e9f7f1",
    borderSuccess: "1px solid #b7e2cf",
    colorWarning: "#fff8eb",
    borderWarning: "1px solid #f5d38b",
    colorError: "#fdecec",
    borderError: "1px solid #f5b5b0",
  },
  Select: {
    menuBoxShadow: "0 10px 30px rgba(15, 23, 42, 0.16)",
    peers: {
      InternalSelection: {
        color: "#ffffff",
        colorActive: "#ffffff",
        colorDisabled: "#f1f5f9",
        textColor: "#0f172a",
        textColorDisabled: "#64748b",
        border: "1px solid #c5cedb",
        borderHover: "1px solid #2f7df6",
        borderActive: "1px solid #2f7df6",
        borderFocus: "1px solid #2f7df6",
        boxShadowHover: "none",
        boxShadowActive: "0 0 0 3px rgba(47, 125, 246, 0.20)",
        boxShadowFocus: "0 0 0 3px rgba(47, 125, 246, 0.20)",
        arrowColor: "#5b6577",
        arrowColorDisabled: "#94a3b8",
        arrowSize: "16px",
        paddingSingle: "0 34px 0 12px",
        paddingMultiple: "3px 34px 0 12px",
        borderWarning: "1px solid #b7791f",
        borderHoverWarning: "1px solid #9a5f13",
        borderActiveWarning: "1px solid #b7791f",
        borderFocusWarning: "1px solid #9a5f13",
        boxShadowHoverWarning: "0 0 0 2px rgba(183, 121, 31, 0.10)",
        boxShadowActiveWarning: "0 0 0 3px rgba(183, 121, 31, 0.18)",
        boxShadowFocusWarning: "0 0 0 3px rgba(183, 121, 31, 0.18)",
        borderError: "1px solid #d14343",
        borderHoverError: "1px solid #b42318",
        borderActiveError: "1px solid #d14343",
        borderFocusError: "1px solid #b42318",
        boxShadowHoverError: "0 0 0 2px rgba(209, 67, 67, 0.10)",
        boxShadowActiveError: "0 0 0 3px rgba(209, 67, 67, 0.18)",
        boxShadowFocusError: "0 0 0 3px rgba(209, 67, 67, 0.18)",
      },
      InternalSelectMenu: {
        optionColorPending: "#f1f5f9",
        optionColorActive: "#eaf2ff",
        optionColorActivePending: "#dbeafe",
        optionTextColorActive: "#185abd",
        optionCheckColor: "#2f7df6",
      },
    },
  },
}

const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#4b8df8",
    primaryColorHover: "#6aa2fa",
    primaryColorPressed: "#2f7df6",
    primaryColorSuppl: "#4b8df8",
    borderRadius: "6px",
    bodyColor: "#0e131d",
    cardColor: "#161c28",
    modalColor: "#161c28",
    popoverColor: "#1c2332",
    tableColor: "#161c28",
    inputColor: "#1c2332",
    borderColor: "#273042",
    dividerColor: "#273042",
    textColorBase: "#e6eaf2",
    textColor1: "#e6eaf2",
    textColor2: "#c4cbd7",
    textColor3: "#939db0",
    fontFamily: "system-ui, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif",
  },
  Card: { borderRadius: "8px" },
  Alert: {
    borderRadius: "8px",
    padding: "10px 12px",
    titleFontWeight: "700",
    colorInfo: "rgba(75, 141, 248, 0.12)",
    borderInfo: "1px solid rgba(75, 141, 248, 0.4)",
    colorSuccess: "rgba(39, 176, 127, 0.12)",
    borderSuccess: "1px solid rgba(39, 176, 127, 0.4)",
    colorWarning: "rgba(224, 163, 58, 0.12)",
    borderWarning: "1px solid rgba(224, 163, 58, 0.4)",
    colorError: "rgba(239, 99, 99, 0.12)",
    borderError: "1px solid rgba(239, 99, 99, 0.4)",
  },
  Select: {
    menuBoxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
    peers: {
      InternalSelection: {
        color: "#1c2332",
        colorActive: "#1c2332",
        colorDisabled: "#151a25",
        textColor: "#e6eaf2",
        textColorDisabled: "#6b7588",
        border: "1px solid #3b475d",
        borderHover: "1px solid #4b8df8",
        borderActive: "1px solid #4b8df8",
        borderFocus: "1px solid #4b8df8",
        boxShadowHover: "none",
        boxShadowActive: "0 0 0 3px rgba(75, 141, 248, 0.25)",
        boxShadowFocus: "0 0 0 3px rgba(75, 141, 248, 0.25)",
        arrowColor: "#939db0",
        arrowColorDisabled: "#6b7588",
        arrowSize: "16px",
        paddingSingle: "0 34px 0 12px",
        paddingMultiple: "3px 34px 0 12px",
      },
      InternalSelectMenu: {
        color: "#1c2332",
        optionColorPending: "#252e40",
        optionColorActive: "rgba(75, 141, 248, 0.16)",
        optionColorActivePending: "rgba(75, 141, 248, 0.24)",
        optionTextColorActive: "#8db8ff",
        optionCheckColor: "#8db8ff",
      },
    },
  },
}

const themeOverrides = computed(() => isDark.value ? darkThemeOverrides : lightThemeOverrides)
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NMessageProvider>
      <div class="app-shell">
        <header class="app-topbar">
          <div class="brand">
            <img class="brand-mark" src="/zzz-mark.svg" alt="">
            <span>ZZZ Calculator</span>
          </div>
          <nav class="nav" aria-label="主导航">
            <RouterLink to="/">
              <Calculator :size="16" />
              <span>计算</span>
            </RouterLink>
            <RouterLink to="/discs">
              <Database :size="16" />
              <span>驱动盘</span>
            </RouterLink>
            <RouterLink to="/accounts">
              <UserRound :size="16" />
              <span>账号</span>
            </RouterLink>
            <RouterLink v-if="enkaImportEnabled" to="/import">
              <Download :size="16" />
              <span>展柜</span>
            </RouterLink>
            <RouterLink to="/settings">
              <HardDrive :size="16" />
              <span>设置</span>
            </RouterLink>
            <RouterLink v-if="maintenanceEnabled" to="/maintenance">
              <Settings2 :size="16" />
              <span>维护</span>
            </RouterLink>
          </nav>
          <span class="account-chip" aria-live="polite">{{ accountChipText }}</span>
        </header>
        <main class="app-main">
          <NAlert v-if="props.startupError" type="error" :title="props.startupError" />
          <NAlert v-if="enkaImportDisabledNotice" type="warning" title="展柜数据导入当前未启用。" />
          <RouterView v-if="!props.startupError" v-slot="{ Component }">
            <KeepAlive include="DiscsView" :max="1">
              <component :is="Component" :key="route.name === 'discs' ? `discs:${accountStore.currentOwnerId}` : route.name" />
            </KeepAlive>
          </RouterView>
        </main>
        <footer class="site-footer">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
          >浙ICP备2026054969号-1</a>
        </footer>
      </div>
    </NMessageProvider>
  </NConfigProvider>
</template>
