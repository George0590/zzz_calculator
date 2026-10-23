import path from "node:path"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { fioniOptimizerInput } from "../tests/fixtures/fioni-optimizer.js"
import { fioniOptimizerStore } from "../tests/fixtures/fioni-optimizer.js"
const catalog = await loadCalculatorContext(path.resolve("."))
const base = fioniOptimizerInput()
const store = fioniOptimizerStore()
const t0 = performance.now()
const res = optimizeDriveDiscs(catalog, store, { ...base, settings: { ...base.settings, algorithm: "exact-super-bound" } })
const ms = performance.now() - t0
const m = res.metrics
console.log("elapsedMs", Math.round(ms))
for (const [k,v] of Object.entries(m)) {
  if (typeof v === "number" || v === null || typeof v === "string" || typeof v === "boolean") console.log(k, "=", typeof v === "number" ? Number(v.toFixed(3)) : v)
}
