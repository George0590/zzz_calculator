<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { NAlert, NButton, NConfigProvider, NMessageProvider, type GlobalThemeOverrides } from "naive-ui"
import { storageIssues, exportUnreadableData } from "@runtime/storage-guard.js"
import { Calculator, Database, Download, HardDrive, Settings2, UserRound } from "lucide-vue-next"
import { useRoute } from "vue-router"
import { useAccountStore } from "@/stores/account"
import { useAppConfigStore } from "@/stores/app-config"
import PersonalBackupPanel from "@/components/PersonalBackupPanel.vue"

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

// 主导航的滑块：量出当前链接的位置，用一个绝对定位的白色块滑过去
const navRef = ref<HTMLElement | null>(null)
const navIndicator = ref({ left: 0, width: 0, visible: false, animated: false })
const navIndicatorStyle = computed(() => ({
  width: `${navIndicator.value.width}px`,
  transform: `translateX(${navIndicator.value.left}px)`,
}))
let navResizeObserver: ResizeObserver | null = null

// animate 为 false 时瞬移：首次定位、窗口缩放、字体加载后的校准都不应播放滑动
function measureNavIndicator(animate: boolean) {
  const active = navRef.value?.querySelector<HTMLElement>("a.router-link-active")
  if (!active) {
    navIndicator.value = { ...navIndicator.value, visible: false }
    return
  }
  navIndicator.value = {
    left: active.offsetLeft,
    width: active.offsetWidth,
    visible: true,
    animated: animate && navIndicator.value.visible,
  }
}

watch(() => route.path, () => {
  void nextTick(() => measureNavIndicator(true))
})

watch(() => [maintenanceEnabled.value, enkaImportEnabled.value], () => {
  void nextTick(() => measureNavIndicator(false))
})

onMounted(() => {
  void nextTick(() => measureNavIndicator(false))
  if (typeof ResizeObserver !== "undefined" && navRef.value) {
    navResizeObserver = new ResizeObserver(() => measureNavIndicator(false))
    navResizeObserver.observe(navRef.value)
  }
})

onBeforeUnmount(() => navResizeObserver?.disconnect())

const themeOverrides: GlobalThemeOverrides = {
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
  // 全站提示统一为浅底 + 细边：信息蓝、成功绿、警告琥珀、错误红
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
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <NMessageProvider>
      <div class="app-shell">
        <header class="app-topbar">
          <div class="brand">
            <img class="brand-mark" src="/zzz-mark.svg" alt="">
            <span>ZZZ Calculator</span>
          </div>
          <nav ref="navRef" class="nav" :class="{ 'nav--has-indicator': navIndicator.visible }" aria-label="主导航">
            <span
              class="nav-indicator"
              :class="{ 'is-visible': navIndicator.visible, 'is-animated': navIndicator.animated }"
              :style="navIndicatorStyle"
              aria-hidden="true"
            ></span>
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
          <NAlert v-if="storageIssues.length" type="error" title="本地数据读取失败，原始内容已保留">
            已阻止相关数据保存。请先下载原始内容，再使用备份恢复；不要清空浏览器数据。
            <NButton @click="exportUnreadableData">导出原始内容</NButton>
          </NAlert>
          <NAlert v-if="props.startupError" type="error" :title="props.startupError" />
          <PersonalBackupPanel v-if="props.startupError" />
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
