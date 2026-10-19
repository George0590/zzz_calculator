import { createHash, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { normalizeDeclaredUid, validateCaptureExport } from "../core/drive-disc-capture.js"

const TERMINAL = new Set(["ready", "failed", "cancelled", "timed_out"])
const PHASES = new Set(["preparing", "waiting_login", "capturing", "parsing", "needs_second_login", "succeeded", "failed", "cancelled", "timed_out"])
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")

export class CaptureError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

async function jsonFile(file, limit = 32_768) {
    if ((await stat(file)).size > limit) throw new Error("文件超过允许大小。")
    return JSON.parse(await readFile(file, "utf8"))
}

async function atomicJson(file, value) {
    await writeFile(`${file}.tmp`, JSON.stringify(value), "utf8")
    await rename(`${file}.tmp`, file)
}

export function launchCapture({ rootDir, directory, id, executable }) {
    return spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(rootDir, "integrations", "drive-exporter", "launch.ps1"),
        "-TaskDirectory", directory, "-TaskId", id, "-ExporterPath", executable], {
        windowsHide: true, stdio: "ignore", shell: false,
    })
}

export class DriveCaptureManager {
    constructor({ rootDir, driveDiscSets, launch = launchCapture, platform = process.platform, now = Date.now, pollMs = 500 }) {
        this.rootDir = rootDir
        this.tasksDir = path.join(rootDir, ".local-runtime", "drive-exporter", "tasks")
        this.executable = path.join(rootDir, ".local-runtime", "drive-exporter", "bin", "zzz-drive-exporter.exe")
        this.driveDiscSets = driveDiscSets
        this.launch = launch
        this.platform = platform
        this.now = now
        this.current = null
        this.child = null
        this.childExited = true
        this.busy = false
        this.tickRunning = false
        this.initialized = this.restore()
        this.timer = setInterval(() => this.tick().catch(error => this.fail("TASK_IO", error.message)), pollMs)
        this.timer.unref?.()
    }
    async restore() {
        try {
            const index = await jsonFile(path.join(this.tasksDir, "current.json"))
            if (!ID.test(index.id)) return
            const task = await jsonFile(path.join(this.tasksDir, index.id, "task.json"))
            if (task.id !== index.id) return
            this.current = task
            if (!TERMINAL.has(task.phase)) {
                await writeFile(path.join(this.directory(), "cancel"), task.id)
                task.phase = "failed"
                task.errorCode = "SERVICE_RESTARTED"
                task.error = "本地服务已重启，本次采集作废；请新建任务。"
                await this.save()
            }
        } catch (error) { if (error.code !== "ENOENT") this.restoreError = "无法恢复上次采集记录，请检查本地任务目录。" }
    }
    directory() { return path.join(this.tasksDir, this.current.id) }
    async save() { await atomicJson(path.join(this.directory(), "task.json"), this.current) }
    view() {
        const task = this.current
        return task ? { ...task, processRunning: !this.childExited } : null
    }
    async status() {
        await this.initialized
        return { available: this.platform === "win32" && existsSync(this.executable),
            supportedClient: "国服正式 Windows PC · CNPRODWin3.2.0", task: this.view(), error: this.restoreError ?? null }
    }
    async start(input) {
        await this.initialized
        if (this.busy || this.tickRunning || !this.childExited || (this.current && !TERMINAL.has(this.current.phase))) {
            throw new CaptureError("TASK_BUSY", "已有采集任务或授权窗口尚未结束，请先取消并等待退出。", 409)
        }
        if (this.platform !== "win32" || !existsSync(this.executable)) {
            throw new CaptureError("EXPORTER_UNAVAILABLE", "本机导出器尚未安装，或当前系统不是 Windows。", 503)
        }
        const ownerId = typeof input.ownerId === "string" ? input.ownerId.trim() : ""
        const ownerLabel = typeof input.ownerLabel === "string" ? input.ownerLabel.trim() : ""
        if (!ownerId || ownerId.length > 160 || !ownerLabel || ownerLabel.length > 200) {
            throw new CaptureError("INVALID_OWNER", "请先选择目标计算器账号。")
        }
        const declaredUid = normalizeDeclaredUid(input.declaredUid)
        this.busy = true
        try {
            const id = randomUUID()
            this.current = { id, ownerId, ownerLabel, declaredUid, uidSkipped: !declaredUid,
                phase: "awaiting_elevation", round: 1, seq: 0, startedAt: this.now(), phaseAt: this.now() }
            await mkdir(this.directory(), { recursive: true })
            await this.save()
            await atomicJson(path.join(this.tasksDir, "current.json"), { id })
            await writeFile(path.join(this.directory(), "lease"), id)
            this.childExited = false
            this.exitCode = null
            try {
                this.child = this.launch({ rootDir: this.rootDir, directory: this.directory(), id, executable: this.executable })
                this.child.once("error", error => { this.childExited = true; this.fail("START_FAILED", error.message) })
                this.child.once("exit", code => { this.childExited = true; this.exitCode = code })
            } catch (error) { this.childExited = true; await this.fail("START_FAILED", error.message) }
            return this.view()
        } finally { this.busy = false }
    }
    requireTask(id) {
        if (!ID.test(id) || this.current?.id !== id) throw new CaptureError("TASK_NOT_FOUND", "采集任务已失效，请重新打开面板。", 404)
    }
    async cancel(id) {
        await this.initialized
        this.requireTask(id)
        if (TERMINAL.has(this.current.phase) && this.childExited) return this.view()
        this.current.cancelRequested = true
        this.current.phase = "cancelling"
        this.current.phaseAt = this.now()
        await writeFile(path.join(this.directory(), "cancel"), id)
        await this.save()
        return this.view()
    }
    async continueSecond(id) {
        await this.initialized
        this.requireTask(id)
        if (this.current.phase !== "needs_second_login" || this.current.round !== 1) {
            throw new CaptureError("INVALID_PHASE", "当前任务不在等待第二次登录。", 409)
        }
        await writeFile(path.join(this.directory(), "continue-second"), id, { flag: "wx" })
        this.current.phase = "preparing"
        this.current.phaseAt = this.now()
        this.current.round = 2
        await this.save()
        return this.view()
    }
    async fail(code, error) {
        if (!this.current || TERMINAL.has(this.current.phase)) return
        this.current.phase = code.endsWith("TIMEOUT") ? "timed_out" : "failed"
        this.current.errorCode = code
        this.current.error = error
        await writeFile(path.join(this.directory(), "cancel"), this.current.id).catch(() => {})
        await this.save().catch(() => {})
    }
    async tick() {
        await this.initialized
        if (this.tickRunning || this.busy || !this.current || TERMINAL.has(this.current.phase)) return
        this.tickRunning = true
        try { await this.pollTask() } finally { this.tickRunning = false }
    }
    async pollTask() {
        const task = this.current
        const directory = this.directory()
        const phaseLimit = task.phase === "awaiting_elevation" ? 60_000 : task.phase === "parsing" ? 125_000 : task.phase === "cancelling" ? 20_000 : 185_000
        if (this.now() - task.startedAt > 610_000 || this.now() - task.phaseAt > phaseLimit) {
            return this.fail("TASK_TIMEOUT", "本次采集等待超时，已发出取消。如果仍显示 Windows 授权窗口，请关闭它后重试。")
        }
        await writeFile(path.join(directory, "lease"), task.id)
        let event = null
        try { event = await jsonFile(path.join(directory, "status.json")) }
        catch (error) { if (error.code !== "ENOENT") return this.fail("PROTOCOL_INVALID", "无法读取本次采集状态。") }
        if (event) {
            if (event.protocolVersion !== 1 || event.taskId !== task.id || !PHASES.has(event.phase)
                || !Number.isSafeInteger(event.seq) || event.seq < 1 || ![1, 2].includes(event.round)) {
                return this.fail("PROTOCOL_INVALID", "导出器状态协议或任务标识不匹配。")
            }
            if (event.seq > task.seq && task.phase !== "cancelling") {
                if (event.phase === "succeeded") {
                    // Wait for process completion as well as the explicit success event.
                    if (!this.childExited) return
                    if (this.exitCode !== 0) return this.fail("PROCESS_EXITED", "导出器报告结果后异常退出，本次结果未导入。")
                    try {
                        const { payload, digest } = await this.readResult(event)
                        if (task.cancelRequested) return
                        task.phase = "ready"
                        task.discCount = payload.driveDiscs.length
                        task.resultDigest = digest
                    } catch (error) { return this.fail("RESULT_INVALID", error.message) }
                } else {
                    if (task.phase !== event.phase) task.phaseAt = this.now()
                    task.phase = event.phase
                    task.errorCode = event.errorCode
                    task.error = event.detail
                }
                task.seq = event.seq
                task.round = event.round
                await this.save()
            }
        }
        if (task.phase === "cancelling" && this.childExited) {
            task.phase = "cancelled"
            task.errorCode = "CANCELLED"
            await this.save()
        } else if (this.childExited && !TERMINAL.has(task.phase)) {
            let launch = null
            try { launch = await jsonFile(path.join(directory, "launch.json")) } catch { /* missing report is failure */ }
            await this.fail(launch?.errorCode ?? "PROCESS_EXITED", launch?.error ?? "采集进程已退出，但没有本次成功结果。")
        }
    }
    async readResult(event) {
        if (event.resultFile !== "calculator.json") throw new Error("结果路径不是本任务预期的文件。")
        const file = path.join(this.directory(), "calculator.json")
        if ((await realpath(file)).toLowerCase() !== path.join(await realpath(this.directory()), "calculator.json").toLowerCase()) {
            throw new Error("结果文件指向任务目录之外。")
        }
        if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error("结果文件过大。")
        const bytes = await readFile(file)
        const payload = validateCaptureExport(JSON.parse(bytes.toString("utf8")), {
            driveDiscSets: this.driveDiscSets, expectedCount: event.discCount,
        })
        return { payload, digest: sha256(bytes) }
    }
    async result(id) {
        await this.initialized
        this.requireTask(id)
        if (this.current.phase !== "ready") throw new CaptureError("RESULT_NOT_READY", "本次任务尚未明确成功，不能预览或导入。", 409)
        const result = await this.readResult({ resultFile: "calculator.json", discCount: this.current.discCount })
        if (result.digest !== this.current.resultDigest) throw new CaptureError("RESULT_CHANGED", "成功后结果文件发生变化，请重新采集。", 409)
        return { task: this.view(), payload: result.payload }
    }
    async close() {
        clearInterval(this.timer)
        await this.initialized
        if (this.current && !TERMINAL.has(this.current.phase)) await this.cancel(this.current.id)
        // No global pktmon stop or elevated process kill. Its lease expires after 15 s even on a hard service exit.
    }
}
