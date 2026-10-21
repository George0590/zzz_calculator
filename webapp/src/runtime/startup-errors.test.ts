import { describe, expect, it } from "vitest"
import { LOCAL_DATA_PARSE_ERROR } from "./storage-guard.js"
import { formatStartupError } from "./startup-errors"

describe("startup error messages", () => {
  it("directs local JSON failures to the raw-data export", () => {
    const error = Object.assign(new Error("构筑数据无法解析"), { code: LOCAL_DATA_PARSE_ERROR })

    expect(formatStartupError(error)).toContain("请先导出原始内容")
    expect(formatStartupError(error)).toContain("构筑数据无法解析")
  })

  it("keeps transaction failures on the refresh path", () => {
    expect(formatStartupError(new Error("数据库锁定"))).toBe(
      "未完成的驱动盘导入自动恢复失败，请刷新页面后再修改配置：数据库锁定",
    )
  })
})
