<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { NAlert, NButton, NConfigProvider, NDropdown, NMessageProvider, type GlobalThemeOverrides } from "naive-ui"
import { storageIssues, exportUnreadableData } from "@runtime/storage-guard.js"
import { Calculator, Check, ChevronDown, Database, Download, HardDrive, Monitor, Moon, Settings2, Sun, UserRound } from "lucide-vue-next"
import { useRoute, useRouter } from "vue-router"
import { useAccountStore } from "@/stores/account"
import { useAppConfigStore } from "@/stores/app-config"
import PersonalBackupPanel from "@/components/PersonalBackupPanel.vue"
import { useTheme } from "@/runtime/theme"

const accountStore = useAccountStore()
const appConfigStore = useAppConfigStore()
const route = useRoute()
const router = useRouter()
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

// 顶栏账号菜单：直接切换账号；失败时转到账号页，那里会显示具体错误
const accountMenuOptions = computed(() => {
  const ready = accountStore.loadState === "ready" && !accountStore.operation
  const owners = (accountStore.owners ?? []).map((owner: any) => {
    const current = owner.id === accountStore.currentOwnerId
    return {
      key: `owner:${owner.id}`,
      label: owner.label || owner.id,
      disabled: !ready || current,
      icon: current ? () => h(Check, { size: 14 }) : undefined,
    }
  })
  return [
    ...owners,
    ...(owners.length ? [{ type: "divider", key: "divider" }] : []),
    { key: "manage", label: "管理账号…" },
  ]
})

async function selectAccountMenu(key: string | number) {
  const value = String(key)
  if (value === "manage") {
    void router.push("/accounts")
    return
  }
  const ownerId = value.startsWith("owner:") ? value.slice("owner:".length) : ""
  if (!ownerId || ownerId === accountStore.currentOwnerId || accountStore.operation) return
  try {
    await accountStore.switchTo(ownerId)
  } catch {
    void router.push("/accounts")
  }
}

// 主导航的滑块：一个绝对定位的白色块滑到当前链接下面。
// 为了切页不卡：链接位置只在导航尺寸变化时量一次并缓存，切页时直接取缓存，不在新页面渲染时强制排版；
// 滑动只用 transform（平移 + 横向缩放），交给合成线程播放，新页面挂载占用主线程时也不会停顿。
const navRef = ref<HTMLElement | null>(null)
const navIndicator = ref({ left: 0, width: 0, baseWidth: 0, visible: false, animated: false })
const navIndicatorStyle = computed(() => {
  const { left, width, baseWidth } = navIndicator.value
  return {
    width: `${baseWidth}px`,
    transform: `translateX(${left}px) scaleX(${baseWidth > 0 ? width / baseWidth : 1})`,
  }
})
let navResizeObserver: ResizeObserver | null = null
let navLinkBoxes = new Map<string, { left: number; width: number }>()

function cacheNavLinkBoxes() {
  const links = [...(navRef.value?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])]
  navLinkBoxes = new Map(links.map(link => [link.getAttribute("href") ?? "", { left: link.offsetLeft, width: link.offsetWidth }]))
}

// animate 为 false 时瞬移：首次定位、窗口缩放、字体加载后的校准都不应播放滑动
function moveNavIndicator(path: string, animate: boolean) {
  const box = navLinkBoxes.get(path)
  if (!box) {
    navIndicator.value = { ...navIndicator.value, visible: false, animated: false }
    return
  }
  const current = navIndicator.value
  const animated = animate && current.visible
  if (animated && current.left === box.left && current.width === box.width) return
  navIndicator.value = {
    left: box.left,
    width: box.width,
    // 动画期间保持原宽度、用缩放过渡；结束后再换成真实宽度
    baseWidth: animated && current.baseWidth > 0 ? current.baseWidth : box.width,
    visible: true,
    animated,
  }
}

function settleNavIndicator() {
  const current = navIndicator.value
  if (current.baseWidth !== current.width) navIndicator.value = { ...current, baseWidth: current.width, animated: false }
}

function measureNavIndicator(animate: boolean) {
  cacheNavLinkBoxes()
  moveNavIndicator(route.path, animate)
}

// 点击后先让滑块开始滑动，再挂载新页面；后台标签页没有动画帧，最多等 50ms
const removeNavGuard = router.beforeEach(async to => {
  if (to.path === route.path || !navLinkBoxes.has(to.path)) return
  moveNavIndicator(to.path, true)
  await Promise.race([
    new Promise(resolve => requestAnimationFrame(() => resolve(null))),
    new Promise(resolve => setTimeout(resolve, 50)),
  ])
})

// 被重定向或取消的导航以最终路由为准
watch(() => route.path, path => {
  void nextTick(() => moveNavIndicator(path, true))
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

onBeforeUnmount(() => {
  navResizeObserver?.disconnect()
  removeNavGuard()
})

// 主题：跟随系统 / 浅色 / 深色，顶栏按钮循环切换
const { preference: themePreference, isDark, naiveTheme, cyclePreference: cycleTheme } = useTheme()
const themeToggleLabel = computed(() => ({
  system: "主题：跟随系统（点击切换为浅色）",
  light: "主题：浅色（点击切换为深色）",
  dark: "主题：深色（点击切换为跟随系统）",
} as const)[themePreference.value])

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

// 深色配置与 tokens.css 里的深色变量取值一致；Naive UI 要对颜色做运算，这里只能写具体色值
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
  Card: {
    borderRadius: "8px",
  },
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
          <nav ref="navRef" class="nav" :class="{ 'nav--has-indicator': navIndicator.visible }" aria-label="主导航">
            <span
              class="nav-indicator"
              :class="{ 'is-visible': navIndicator.visible, 'is-animated': navIndicator.animated }"
              :style="navIndicatorStyle"
              aria-hidden="true"
              @transitionend="settleNavIndicator"
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
          <div class="topbar-actions">
            <button
              type="button"
              class="theme-toggle"
              data-testid="theme-toggle"
              :title="themeToggleLabel"
              :aria-label="themeToggleLabel"
              @click="cycleTheme"
            >
              <Monitor v-if="themePreference === 'system'" :size="16" aria-hidden="true" />
              <Sun v-else-if="themePreference === 'light'" :size="16" aria-hidden="true" />
              <Moon v-else :size="16" aria-hidden="true" />
            </button>
            <NDropdown trigger="click" placement="bottom-end" :options="accountMenuOptions" @select="selectAccountMenu">
              <button type="button" class="account-chip" :title="accountChipText" aria-live="polite" aria-haspopup="menu" data-testid="account-switcher">
                <span class="account-chip-label">{{ accountChipText }}</span><ChevronDown :size="14" aria-hidden="true" class="account-chip-chevron" />
              </button>
            </NDropdown>
          </div>
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
