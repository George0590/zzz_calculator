# 本地抓包导出器接入

独立进程 `zzz-drive-exporter.exe`，基于上游
<https://github.com/Treageer/zzz-drive-exporter/commit/8efb171b5e6b33ec464e8b43a28e5fb792fbc160>。
原 CLI 参数保留；机器协议版本为 1，仅支持国服正式 Windows PC，当前协议适配到 `CNPRODWin3.2.0`。

## 构建

本目录不提交二进制、完整第三方仓库或采集数据。`build.ps1` 固定上游提交，下载并按上游 Cargo.lock 的
SHA256 校验 pktmon 0.6.2，应用两份补丁，再运行 Rust 测试和 release 构建。
需要 Git、Rust 工具链以及匹配的 Windows 链接工具（MSVC Build Tools 或 GNU/LLVM-MinGW）。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File integrations/drive-exporter/build.ps1
```

可传 `-Cargo` 指定 cargo 路径、`-Proxy` 指定下载代理；`-PrepareOnly` 只准备可审查源码。
已有源码若不符合固定版本或补丁，不执行 reset/clean；停止并要求先保留本地内容。
构建结果位于 `.local-runtime/drive-exporter/bin/`，对应源码位于 `source/`，`build-info.json` 记录源码补丁与 EXE 哈希。

`exporter.patch` 仅修改 CLI 入口、采集阶段观察/清理、恢复失败分类和依赖路径；`machine.rs` 是新增机器模式。
`pktmon.patch` 添加安全构造函数：已有旧版 pktmon 会话运行时返回 busy，取消后只停止自己成功启动的会话，
不注册会重新打开并清理全局驱动的退出钩子，也不卸载全局驱动。原有人工构造 API 保留。

## 机器协议

Node 生成 UUID，创建独立 `tasks/<uuid>/`，通过 `launch.ps1` 仅对 EXE 请求 UAC；网页和 Node 不提权。
EXE 只接收 `--machine-task-dir` 和 `--task-id`。机器模式使用固定文件名，普通 CLI 的输出路径选项不参与机器模式。

- `task.json`：Node 保存冻结的计算器 ownerId、账号显示名、声明 UID/跳过状态。
- `lease`：Node 每 500 ms 续期；EXE 检查超过 15 秒未续期便停止，服务崩溃也适用。
- `status.json`：EXE 临时文件写入、sync、同目录 rename 后发布；包含 protocolVersion、taskId、seq、phase、round。
- `cancel`、`continue-second`：仅本任务的取消、第二轮明确确认。没有跨任务 baseline 搜索。
- `calculator.pending.json`、`zood.pending.json`：完整导出后改名为正式文件，最后才发布 succeeded（discCount、resultFile）。
- `captures/`：仅本次任务的第一/第二次登录采集。原始信息不得上传或提交 Git。

成功条件是匹配任务的明确 succeeded、进程正常完成、预期正式路径及原生格式/字段/盘数全部校验通过。
读取成功结果时再次验证 SHA256；文件存在、mtime 或退出码 0 不能单独触发预览。
服务器只返回 ready；浏览器库存事务提交并回读成功后才显示“已导入”。

单轮采集 180 秒、解析 120 秒、第二轮确认 180 秒、总任务 600 秒。Node 另有授权 60 秒与稍宽的外层截止时间。
取消/服务丢失时中止拥有 stream 的任务，析构释放本次 pktmon 会话；计算线程随 EXE 退出。
若 UAC 窗口仍未处理，页面会显示等待进程退出；后续才授权时，EXE 会先看到 cancel 或过期 lease 并退出。

首轮只对 `RECOVERY_UNAVAILABLE` 进入第二轮，写盘/映射等失败直接报错；第二轮失败终止，不循环登录。
原有恢复算法需要至少 8192 字节；收到更小的目标响应会明确报告暂不支持，不降低完整性门槛，不解释成空库存。

## 许可

上游及修改后的导出器代码使用 AGPL-3.0-only，见本目录 LICENSE、THIRD_PARTY_NOTICES.md。
pktmon 使用 MIT，源码准备后其许可保存在 `source/vendor/pktmon/LICENSE`。
计算器原有许可证没有变更。此工作没有发布或分发二进制；将来分发时必须同时提供对应版本源码、机器模式、
两份补丁、构建说明及第三方许可，并核对组合分发义务。独立 EXE 不代表自动免除许可义务。
