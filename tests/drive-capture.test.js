import assert from "node:assert/strict"
import { test } from "node:test"
import { EventEmitter } from "node:events"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DriveCaptureManager } from "../backend/driveCapture.js"
import { validateCaptureExport, normalizeDeclaredUid } from "../core/drive-disc-capture.js"
import { buildScannerImportPlan, createEmptyInventoryStore, normalizeInventoryStore } from "../core/inventory-model.js"

const fixture = JSON.parse(await readFile(new URL("./fixtures/drive-capture-v1.json", import.meta.url), "utf8"))
const sets = [{ id: "woodpecker_electro" }]
const payload = () => structuredClone(fixture)
const options = { ownerId: "default", captureImport: true, removeMissing: false }

test("capture preserves native units, item identity and local references across repeats/upgrades", () => {
    const input = payload()
    validateCaptureExport(input, { driveDiscSets: sets, expectedCount: 1 })
    const first = buildScannerImportPlan(createEmptyInventoryStore(), input, options)
    assert.equal(first.summary.added, 1)
    const disc = first.nextStore.driveDiscs[0]
    assert.equal(disc.id, "10000000000000001")
    assert.equal(disc.mainStat.value, 30)
    assert.equal(disc.subStats[0].value, 4.8)
    assert.equal(disc.provenance.calculatorJson.exporter, "zzz-drive-exporter")
    disc.equippedBy = "hoshimi_miyabi"
    disc.reservedForAgentId = "hoshimi_miyabi"
    disc.excludedForAgentIds = ["ellen_joe"]
    first.nextStore.driveDiscLoadouts = [{ id: "my-build", ownerId: "default", driveDiscIdsBySlot: { 6: disc.id } }]
    const before = normalizeInventoryStore(first.nextStore)
    const repeat = buildScannerImportPlan(before, input, { ...options, sourcePath: "new-task" })
    assert.equal(repeat.summary.added, 0)
    input.driveDiscs[0].locked = false
    input.driveDiscs[0].level = 12
    const upgraded = buildScannerImportPlan(before, input, options)
    assert.equal(upgraded.summary.updated, 1)
    assert.equal(upgraded.nextStore.driveDiscs[0].id, disc.id)
    assert.equal(upgraded.nextStore.driveDiscs[0].locked, false)
    for (const field of ["equippedBy", "reservedForAgentId", "excludedForAgentIds"]) {
        assert.deepEqual(upgraded.nextStore.driveDiscs[0][field], before.driveDiscs[0][field])
    }
    assert.deepEqual(upgraded.nextStore.driveDiscLoadouts, before.driveDiscLoadouts)
    assert.equal(upgraded.summary.removed, 0)
    assert.equal(normalizeDeclaredUid(""), "")
    assert.equal(normalizeDeclaredUid(" 123456789 "), "123456789")
    assert.throws(() => normalizeDeclaredUid("abc"))
})

test("equal attributes with different item IDs stay distinct; legacy identity requires a decision", () => {
    const input = payload()
    input.driveDiscs.push({ ...structuredClone(input.driveDiscs[0]), id: "10000000000000002" })
    const two = buildScannerImportPlan(createEmptyInventoryStore(), input, options)
    assert.equal(two.summary.added, 2)
    const legacy = { ...payload().driveDiscs[0], id: "scanner-old", ownerId: "default", source: { type: "zzz-scanner", sequence: 7 } }
    const store = { ...createEmptyInventoryStore(), driveDiscs: [legacy] }
    const review = buildScannerImportPlan(store, payload(), options)
    assert.equal(review.hasUnresolvedConflicts, true)
    const conflict = review.reconciliation.conflicts[0]
    const merged = buildScannerImportPlan(store, payload(), { ...options, resolutions: { [conflict.key]: { action: "update", existingId: "scanner-old" } } })
    assert.equal(merged.nextStore.driveDiscs.length, 1)
    assert.equal(merged.nextStore.driveDiscs[0].id, "scanner-old")
    assert.ok(merged.nextStore.driveDiscs[0].provenance.scanner)
    assert.ok(merged.nextStore.driveDiscs[0].provenance.calculatorJson)
    assert.equal(buildScannerImportPlan(merged.nextStore, payload(), options).hasUnresolvedConflicts, false)
    const separate = buildScannerImportPlan(store, payload(), { ...options, resolutions: { [conflict.key]: { action: "add" } } })
    assert.equal(separate.nextStore.driveDiscs.length, 2)
})

test("capture rejects unsupported versions, sets, stats, units, numbers and duplicate item IDs", () => {
    for (const mutate of [
        x => { x.version = 2 }, x => { x.driveDiscs = [] },
        x => { x.driveDiscs[0].setId = "unknown"; x.driveDiscs[0].setName = "unknown" },
        x => { x.driveDiscs[0].subStats[0].stat = "unknown" },
        x => { x.driveDiscs[0].subStats[0].stat = "impact" },
        x => { x.driveDiscs[0].partition = 1 },
        x => { x.driveDiscs[0].subStats[0].value = null },
        x => { x.driveDiscs[0].subStats[0].value = -1 },
        x => { x.driveDiscs[0].subStats[0].mode = "flat" },
        x => { x.driveDiscs[0].level = 16 },
        x => { x.driveDiscs[0].locked = "false" },
        x => { x.driveDiscs[0].id = 10000000000000001 },
        x => { x.driveDiscs.push(structuredClone(x.driveDiscs[0])) },
    ]) {
        const input = payload(); mutate(input)
        assert.throws(() => validateCaptureExport(input, { driveDiscSets: sets }))
    }
})

async function harness(t) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "zzz-capture-test-"))
    let time = Date.now()
    let child
    const manager = new DriveCaptureManager({ rootDir, driveDiscSets: sets, platform: "win32", now: () => time,
        launch: () => { child = new EventEmitter(); return child } })
    clearInterval(manager.timer)
    await mkdir(path.dirname(manager.executable), { recursive: true })
    await writeFile(manager.executable, "test fixture, never executed")
    t.after(async () => { await manager.close(); assert.ok(rootDir.startsWith(path.join(os.tmpdir(), "zzz-capture-test-"))); await rm(rootDir, { recursive: true, force: true }) })
    return {
        manager, rootDir,
        start: () => manager.start({ ownerId: "default", ownerLabel: "测试账号", declaredUid: "" }),
        exit: code => child.emit("exit", code),
        advance: ms => { time += ms },
        write: (file, content) => writeFile(path.join(manager.directory(), file), typeof content === "string" ? content : JSON.stringify(content)),
        report: (phase, extra = {}) => writeFile(path.join(manager.directory(), "status.json"), JSON.stringify({ protocolVersion: 1, taskId: manager.current.id, seq: manager.current.seq + 1, phase, round: 1, ...extra })),
    }
}

test("only the matching successful report plus validated atomic result enables preview", async t => {
    const h = await harness(t); const task = await h.start()
    await h.write("calculator.json", payload())
    await h.report("succeeded", { resultFile: "calculator.json", discCount: 1 })
    await h.manager.tick()
    await assert.rejects(h.manager.result(task.id), /尚未明确成功/)
    h.exit(0); await h.manager.tick()
    assert.equal(h.manager.current.phase, "ready")
    assert.equal((await h.manager.result(task.id)).payload.driveDiscs.length, 1)
    await h.write("calculator.json", { ...payload(), exportedAt: "2026-10-20T00:00:00.000Z" })
    await assert.rejects(h.manager.result(task.id), /发生变化/)
})

test("failed new task never reads the previous task's successful file", async t => {
    const h = await harness(t); const first = await h.start()
    await h.write("calculator.json", payload()); await h.report("succeeded", { resultFile: "calculator.json", discCount: 1 })
    h.exit(0); await h.manager.tick()
    const second = await h.start()
    assert.notEqual(second.id, first.id)
    h.exit(0); await h.manager.tick()
    assert.equal(h.manager.current.phase, "failed")
    await assert.rejects(h.manager.result(second.id))
    await assert.rejects(h.manager.result(first.id))
})

test("exit zero with needs_second_login is never treated as success", async t => {
    const h = await harness(t); const task = await h.start()
    await h.write("calculator.json", payload()); await h.report("needs_second_login")
    h.exit(0); await h.manager.tick()
    assert.equal(h.manager.current.phase, "failed")
    await assert.rejects(h.manager.result(task.id))
})

test("second round requires an explicit confirmation and pairing failure stays terminal", async t => {
    const h = await harness(t); const task = await h.start()
    await assert.rejects(h.manager.continueSecond(task.id))
    await h.report("needs_second_login"); await h.manager.tick()
    assert.equal(h.manager.current.phase, "needs_second_login")
    await h.manager.continueSecond(task.id)
    await assert.rejects(h.manager.continueSecond(task.id))
    await h.report("failed", { round: 2, errorCode: "PAIRING_FAILED" }); h.exit(1); await h.manager.tick()
    await assert.rejects(h.manager.result(task.id))
    assert.equal(h.manager.current.errorCode, "PAIRING_FAILED")
})

for (const scenario of ["half-json", "bad-version", "wrong-count", "missing-file", "escaped-path", "wrong-task", "wrong-protocol"]) {
    test(`invalid result is blocked: ${scenario}`, async t => {
        const h = await harness(t); const task = await h.start()
        const input = payload()
        if (scenario === "bad-version") input.version = 9
        if (scenario !== "missing-file") await h.write("calculator.json", scenario === "half-json" ? "{\"format\":" : input)
        await h.report("succeeded", { resultFile: scenario === "escaped-path" ? "../calculator.json" : "calculator.json",
            discCount: scenario === "wrong-count" ? 2 : 1,
            ...(scenario === "wrong-task" ? { taskId: "another-task" } : {}),
            ...(scenario === "wrong-protocol" ? { protocolVersion: 2 } : {}) })
        h.exit(0); await h.manager.tick()
        assert.equal(h.manager.current.phase, "failed")
        await assert.rejects(h.manager.result(task.id))
    })
}

test("duplicate starts, cancellation, timeout, UAC refusal and process exit are bounded", async t => {
    const h = await harness(t); let task = await h.start()
    await assert.rejects(h.start(), /已有采集/)
    await h.manager.cancel(task.id)
    await h.write("calculator.json", payload()); await h.report("succeeded", { resultFile: "calculator.json", discCount: 1 })
    h.exit(0); await h.manager.tick()
    assert.equal(h.manager.current.phase, "cancelled")
    await assert.rejects(h.manager.result(task.id))
    task = await h.start(); h.advance(61_000); await h.manager.tick()
    assert.equal(h.manager.current.phase, "timed_out")
    assert.equal(await readFile(path.join(h.manager.directory(), "cancel"), "utf8"), task.id)
    await assert.rejects(h.start())
    h.exit(1); task = await h.start()
    await h.write("launch.json", { errorCode: "UAC_REJECTED", error: "User cancelled" }); h.exit(1); await h.manager.tick()
    assert.equal(h.manager.current.errorCode, "UAC_REJECTED")
    task = await h.start(); h.exit(1); await h.manager.tick()
    assert.equal(h.manager.current.errorCode, "PROCESS_EXITED")
})

test("service restart cancels incomplete work; ready results remain recoverable", async t => {
    const h = await harness(t); const task = await h.start()
    clearInterval(h.manager.timer)
    const restored = new DriveCaptureManager({ rootDir: h.rootDir, driveDiscSets: sets })
    clearInterval(restored.timer)
    await restored.initialized
    assert.equal(restored.current.errorCode, "SERVICE_RESTARTED")
    assert.equal(await readFile(path.join(restored.directory(), "cancel"), "utf8"), task.id)
    await assert.rejects(restored.result(task.id))
    await restored.close()
    const ready = await harness(t)
    const readyTask = await ready.start()
    await ready.write("calculator.json", payload())
    await ready.report("succeeded", { resultFile: "calculator.json", discCount: 1 })
    ready.exit(0); await ready.manager.tick()
    const reopened = new DriveCaptureManager({ rootDir: ready.rootDir, driveDiscSets: sets })
    clearInterval(reopened.timer)
    await reopened.initialized
    assert.equal(reopened.current.phase, "ready")
    assert.equal((await reopened.result(readyTask.id)).payload.driveDiscs.length, 1)
    await reopened.close()
})
