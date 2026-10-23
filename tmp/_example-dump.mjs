import path from "node:path"
import { loadCalculatorContext } from "../backend/calculator.js"
const catalog = await loadCalculatorContext(path.resolve("."))
console.log("example keys", Object.keys(catalog.examples ?? {}))
const y = catalog.examples?.yeShunguang?.input
console.log(JSON.stringify(y, null, 1).slice(0, 2500))
