import fs from "node:fs"
const s = JSON.parse(fs.readFileSync("data/user_drive_discs.json","utf8"))
console.log("keys", Object.keys(s))
console.log("currentOwnerId", s.currentOwnerId, "owners", JSON.stringify(s.owners), "discs", s.driveDiscs?.length)
const sets = {}
for (const d of s.driveDiscs ?? []) sets[d.setId] = (sets[d.setId] ?? 0) + 1
console.log("sets", sets)
console.log("sample disc keys", Object.keys(s.driveDiscs?.[0] ?? {}))
const a = JSON.parse(fs.readFileSync("data/agents.json","utf8"))
const arr = Array.isArray(a) ? a : (a.agents ?? [])
const f = arr.find(x => x.id === "fioni")
console.log("preferred", JSON.stringify(f.preferredDriveDiscs))
console.log("defaultCalc", JSON.stringify(f.defaultCalculationConfig))
