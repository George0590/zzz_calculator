import { createPinia } from "pinia"
import { createApp } from "vue"
import App from "@/App.vue"
import { router } from "@/router"
import { useAccountStore } from "@/stores/account"
import { useAppConfigStore } from "@/stores/app-config"
import { recoverAllPendingDriveDiscImports } from "@runtime/drive-disc-import-transaction"
import { recoverPendingEnkaImport } from "@runtime/enka-import-transaction"
import { loadUserDriveDiscStoreFresh } from "@runtime/local-store.js"
import { recoverPersonalRestore } from "@runtime/personal-backup"
import "@/styles/tokens.css"
import "@/styles/workbench.css"
import { initTheme } from "@/runtime/theme"

// 挂载前先套用主题，避免深色模式下先闪一下浅色
const themeReady = initTheme()

const STARTUP_RECOVERY_LOCK_TIMEOUT_MS = 5_000
// 深色主题下载卡住时不阻塞挂载，最多等这么久，之后照常显示并在加载完成后切换
const THEME_READY_TIMEOUT_MS = 1_500

async function bootstrap() {
  const pinia = createPinia()
  const accountStore = useAccountStore(pinia)
  let startupError = ""
  try {
    await recoverPersonalRestore()
    const recoveryLockOptions = {
      waitTimeoutMs: STARTUP_RECOVERY_LOCK_TIMEOUT_MS,
      purpose: "恢复未完成的驱动盘导入",
    }
    await recoverAllPendingDriveDiscImports(recoveryLockOptions)
    const store = await loadUserDriveDiscStoreFresh()
    const ownerIds = new Set([
      String(store?.currentOwnerId ?? "default"),
      ...(store?.owners ?? []).map((owner: any) => String(owner?.id ?? "")).filter(Boolean),
      ...Object.keys(store?.enkaImportState?.byOwner ?? {}),
    ])
    for (const ownerId of ownerIds) {
      await recoverPendingEnkaImport(ownerId, recoveryLockOptions)
    }
  } catch (error) {
    startupError = `本地数据读取或事务恢复失败，已停止修改。请先导出原始内容或从备份恢复：${error instanceof Error ? error.message : String(error)}`
  }
  if (!startupError) {
    try {
      await accountStore.ensureLoaded()
    } catch {
      // Account-dependent views expose the shared error state and retry action.
    }
  }
  try {
    await useAppConfigStore(pinia).load()
  } catch {
    // The store starts with all optional feature flags disabled.
  }

  await Promise.race([themeReady, new Promise(resolve => setTimeout(resolve, THEME_READY_TIMEOUT_MS))])
  createApp(App, { startupError })
    .use(pinia)
    .use(router)
    .mount("#app")
}

void bootstrap()
