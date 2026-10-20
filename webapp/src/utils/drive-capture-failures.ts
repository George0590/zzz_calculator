// 抓包失败按“下一步该做什么”归类：每类只给一个主操作，错误码退为诊断信息。
export type CaptureFailureCategory = "retry" | "environment" | "pairing" | "unsupported" | "decode"

export interface CaptureFailureGuide {
  category: CaptureFailureCategory
  title: string
  description: string
  primaryLabel: string
  primaryAction: "restart" | "scan"
}

export const CAPTURE_FAILURE_CODES: Record<CaptureFailureCategory, readonly string[]> = {
  retry: ["UAC_REJECTED", "TASK_TIMEOUT", "RESPONSE_TIMEOUT", "CONFIRM_TIMEOUT", "SERVICE_LOST", "SERVICE_RESTARTED", "PROCESS_EXITED"],
  environment: ["CAPTURE_BUSY", "CAPTURE_PERMISSION", "CAPTURE_FAILED", "START_FAILED", "CAPTURE_MUTEX_FAILED", "TASK_IO", "RESULT_WRITE"],
  pairing: ["PAIRING_FAILED"],
  unsupported: ["VERSION_MAPPING", "SMALL_INVENTORY_UNSUPPORTED", "EMPTY_INVENTORY"],
  decode: ["PROTOCOL_INVALID", "RESULT_INVALID", "DECODE_FAILED", "DECODE_TIMEOUT"],
}

// 每个错误码的具体原因，显示在类别说明之下。
export const CAPTURE_ERROR_DETAILS: Record<string, string> = {
  START_FAILED: "无法启动本机导出器，请检查安装文件和 Windows 授权。",
  CAPTURE_MUTEX_FAILED: "无法取得本机采集锁，请稍后重试。",
  PROTOCOL_INVALID: "导出器返回的状态不符合本次任务协议。",
  TASK_IO: "本地任务文件读写失败，请检查磁盘空间与目录权限。",
  TASK_TIMEOUT: "等待超过时间限制，已请求停止。如 Windows 授权窗口仍在，请先关闭。",
  UAC_REJECTED: "已取消管理员授权。",
  CAPTURE_BUSY: "系统中已有其他 pktmon 采集任务，请先结束正在使用的其他采集工具。",
  CAPTURE_PERMISSION: "采集权限不足，请重新开始并允许 Windows 管理员授权。",
  CAPTURE_FAILED: "无法启动或完成抓包，请检查权限和网络环境。",
  RESPONSE_TIMEOUT: "3 分钟内未收到完整的驱动盘数据，请确认使用国服正式 PC 客户端并在提示后登录。",
  SMALL_INVENTORY_UNSUPPORTED: "已收到数据，但数据量不足以可靠恢复，暂不支持库存较少的账号。",
  EMPTY_INVENTORY: "未读取到驱动盘，暂不支持空库存。",
  PAIRING_FAILED: "两次登录的数据无法对应，可能是账号、版本或库存在两次之间发生了变化。",
  VERSION_MAPPING: "导出器尚未适配当前版本的套装或属性数据。",
  RESULT_WRITE: "导出文件写入失败，请检查磁盘空间和目录权限。",
  RESULT_INVALID: "本次结果校验失败。",
  DECODE_FAILED: "驱动盘数据恢复或解码失败。",
  DECODE_TIMEOUT: "解析超过时间限制，已停止本次任务。",
  CONFIRM_TIMEOUT: "等待第二次登录超时。",
  SERVICE_LOST: "本地服务连接中断，采集已停止。",
  SERVICE_RESTARTED: "本地服务已重启，本次任务已作废。",
  PROCESS_EXITED: "采集进程已退出，未交付本次结果。",
}

const GUIDES: Record<CaptureFailureCategory, Omit<CaptureFailureGuide, "category">> = {
  retry: { title: "本次采集未完成", description: "未在时限内完成授权或登录，可直接重新开始。", primaryLabel: "重新开始", primaryAction: "restart" },
  environment: { title: "采集环境需要处理", description: "本机环境阻止了采集，处理后可重新开始。", primaryLabel: "已处理，重新开始", primaryAction: "restart" },
  pairing: { title: "两次登录数据不一致", description: "两次登录之间账号、版本或库存发生了变化，需要重新采集。", primaryLabel: "重新采集", primaryAction: "restart" },
  unsupported: { title: "当前情况暂不支持抓包", description: "并非操作问题，本次无法通过抓包读取，可改用扫描助手。", primaryLabel: "改用扫描助手", primaryAction: "scan" },
  decode: { title: "数据解析失败", description: "本次数据未能解析，可重新开始。", primaryLabel: "重新开始", primaryAction: "restart" },
}

const CATEGORY_BY_CODE = new Map(Object.entries(CAPTURE_FAILURE_CODES)
  .flatMap(([category, codes]) => codes.map(code => [code, category as CaptureFailureCategory])))

export function captureFailureCategory(code: string | null | undefined): CaptureFailureCategory {
  return CATEGORY_BY_CODE.get(String(code ?? "")) ?? "retry"
}

// 解析类失败连续出现时不再建议重试，改为引导扫描助手。
export function captureFailureGuide(code: string | null | undefined, decodeFailures = 0): CaptureFailureGuide {
  const category = captureFailureCategory(code)
  const guide = { category, ...GUIDES[category] }
  if (category === "decode" && decodeFailures >= 2) {
    return { ...guide, description: "数据连续两次未能解析，建议改用扫描助手。", primaryLabel: "改用扫描助手", primaryAction: "scan" }
  }
  return guide
}
