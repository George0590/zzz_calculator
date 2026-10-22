import { LOCAL_DATA_PARSE_ERROR } from "@runtime/storage-guard.js"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isLocalDataParseError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === LOCAL_DATA_PARSE_ERROR)
}

export function formatStartupError(error: unknown): string {
  const message = errorMessage(error)
  if (isLocalDataParseError(error)) {
    return `本地数据读取失败，已停止修改。请先导出原始内容：${message}`
  }
  return `未完成的驱动盘导入自动恢复失败，请刷新页面后再修改配置：${message}`
}
