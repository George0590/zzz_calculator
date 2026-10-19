import { hasUnknownDriveDiscStat, normalizeDriveDiscImport } from "./inventory-model.js"

// Capture validation is deliberately stricter than restoring a user's native backup.
// Keep the game item identity independent of task IDs and user-declared account UIDs.
export function validateCaptureExport(payload, { driveDiscSets, expectedCount } = {}) {
    if (payload?.format !== "zzz-calculator-drive-disc-export" || payload?.version !== 1) {
        throw new Error("抓包结果不是支持的计算器原生 JSON v1。")
    }
    if (payload.sourceAccount?.label !== "zzz-drive-exporter" || payload.sourceAccount?.id != null) {
        throw new Error("本次文件的导出来源标识不符合抓包协议。")
    }
    if (!Array.isArray(payload.driveDiscs) || !payload.driveDiscs.length) {
        throw new Error("未取得驱动盘；首版不支持空库存，未修改本地库存。")
    }
    if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount)
        || expectedCount !== payload.driveDiscs.length)) {
        throw new Error("结果盘数与本次采集成功报告不一致。")
    }
    const sets = new Set((driveDiscSets ?? []).map(set => set.id))
    const normalized = normalizeDriveDiscImport(payload)
    for (const [index, disc] of payload.driveDiscs.entries()) {
        const name = `第 ${index + 1} 张盘`
        if (typeof disc.id !== "string" || !/^[1-9]\d*$/.test(disc.id)) throw new Error(`${name}物品 ID 无效。`)
        if (!Number.isInteger(disc.partition) || disc.partition < 1 || disc.partition > 6) throw new Error(`${name}槽位无效。`)
        if (!sets.has(normalized.driveDiscs[index].setId)) throw new Error(`${name}的套装映射未知。`)
        const maxLevel = { B: 9, A: 12, S: 15 }[disc.rarity]
        if (!maxLevel || disc.maxLevel !== maxLevel || !Number.isInteger(disc.level)
            || disc.level < 0 || disc.level > maxLevel) throw new Error(`${name}品质或等级无效。`)
        if (typeof disc.locked !== "boolean" || disc.equippedBy != null) throw new Error(`${name}锁定或穿戴字段无效。`)
        if (hasUnknownDriveDiscStat(disc) || disc.subStats.length > 4) throw new Error(`${name}包含未知词条。`)
        const mainStats = {
            1: ["hpFlat"], 2: ["atkFlat"], 3: ["defFlat"],
            4: ["hpPct", "atkPct", "defPct", "critRate", "critDmg", "anomalyProficiency"],
            5: ["hpPct", "atkPct", "defPct", "penRatio", "physicalDmg", "fireDmg", "iceDmg", "electricDmg", "etherDmg", "windDmg"],
            6: ["hpPct", "atkPct", "defPct", "impact", "energyRegen", "anomalyMastery"],
        }
        const subStats = ["hpFlat", "atkFlat", "defFlat", "hpPct", "atkPct", "defPct", "critRate", "critDmg", "anomalyProficiency", "penFlat"]
        if (!mainStats[disc.partition].includes(disc.mainStat.stat) || disc.subStats.some(stat => !subStats.includes(stat.stat))) {
            throw new Error(`${name}词条不适用于该槽位或副词条池。`)
        }
        const subKeys = disc.subStats.map(stat => stat.stat)
        if (new Set(subKeys).size !== subKeys.length || subKeys.includes(disc.mainStat.stat)) {
            throw new Error(`${name}包含重复词条。`)
        }
        for (const stat of [disc.mainStat, ...disc.subStats]) {
            const flat = ["hpFlat", "atkFlat", "defFlat", "penFlat", "anomalyProficiency"].includes(stat.stat)
            if (typeof stat.value !== "number" || !Number.isFinite(stat.value) || stat.value <= 0
                || stat.mode !== (flat ? "flat" : "pct")) throw new Error(`${name}词条数值或单位无效。`)
        }
    }
    return payload
}

export function normalizeDeclaredUid(value) {
    const uid = String(value ?? "").trim()
    if (uid && !/^\d+$/.test(uid)) throw new Error("UID 只能填写数字，也可以留空跳过。")
    if (uid.length > 32) throw new Error("UID 输入过长，请核对。")
    return uid
}

export function assertCaptureOwner(store, ownerId) {
    if (!store?.owners?.some(owner => owner.id === ownerId)) {
        throw new Error("目标计算器账号已删除，结果已保留，不能写入其他账号。")
    }
    if (store.currentOwnerId !== ownerId) {
        throw new Error("当前账号与采集目标不同，请切回目标账号后重新预览。结果已保留。")
    }
}
