import path from "node:path"
import { loadCalculatorContext } from "../backend/calculator.js"
const catalog = await loadCalculatorContext(path.resolve("."))
const y = catalog.examples?.yeShunguang?.input
console.log("input keys", Object.keys(y ?? {}))
console.log("damage keys", Object.keys(y?.damage ?? {}))
console.log("settings keys", Object.keys(y?.settings ?? {}))
console.log("combatBuffs", JSON.stringify(y?.combatBuffs))
console.log("events", JSON.stringify((y?.damage?.events ?? []).map(e=>({id:e.id,kind:e.kind,settlementType:e.settlementType,count:e.count}))))
console.log(JSON.stringify({agentId:y?.agentId, coreSkillLevel:y?.coreSkillLevel, wEngineId:y?.wEngineId, cinemaLevel:y?.cinemaLevel}))
