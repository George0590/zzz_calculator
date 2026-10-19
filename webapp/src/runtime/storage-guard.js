import { shallowRef } from "vue"

// Keep the original value in place. A failed read must never become an empty
// document that an autosave can overwrite.
export const storageIssues = shallowRef([])

/** @param {string} key @param {any} fallback @returns {any} */
export function readSafeJson(key, fallback = null) {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    try {
        const value = JSON.parse(raw)
        storageIssues.value = storageIssues.value.filter(issue => issue.key !== key)
        return value
    } catch {
        const error = new Error(`本地数据无法解析，已保留原始内容并阻止相关保存：${key}。请先导出原始内容，再从备份恢复。`)
        error.code = "LOCAL_DATA_PARSE_ERROR"
        error.storageKey = key
        storageIssues.value = [...storageIssues.value.filter(issue => issue.key !== key), { key, raw }]
        throw error
    }
}

export function exportUnreadableData() {
    const blob = new Blob([JSON.stringify({ format: "zzz-calculator-unreadable-data", version: 1,
        records: storageIssues.value.map(issue => ({ key: issue.key, raw: localStorage.getItem(issue.key) ?? issue.raw })),
    }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "绝区零计算器-原始数据恢复副本.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
}
