import path from "node:path"
import { loadCalculatorContext } from "../backend/calculator.js"
import { optimizeDriveDiscs } from "../backend/driveDiscOptimizer.js"
import { velinaOptimizerStore, velinaOptimizerInput } from "../tests/fixtures/velina-optimizer.js"
const rootDir = path.resolve(".")
const catalog = await loadCalculatorContext(rootDir)
for (const variants of [2,3]) {
  const store = velinaOptimizerStore({ variants })
  const input = velinaOptimizerInput()
  const t0 = performance.now()
  const res = optimizeDriveDiscs(catalog, store, input)
  const ms = performance.now()-t0
  const m = res.metrics
  console.log(JSON.stringify({role:"velina",variants,ms:Math.round(ms),estimated:m.estimatedCombinationCount,evaluated:m.evaluated,scored:m.scoredCombinationCount,prunedSuper:m.prunedBySuperBound,prunedChunk:m.prunedByChunkBound,superChecks:m.superBoundChecks,safeFallbacks:m.safeBoundFallbacks,kernel:m.scoreKernel,kernelFallback:m.scoreKernelFallbackReason,specCalls:m.specializedScoreCalls,specFallbacks:m.specializedScoreFallbacks,specReason:m.specializedScoreFallbackReason,objCalls:m.objectiveScalarCalls,objFallbacks:m.objectiveScalarFallbacks,denseMs:Math.round(m.denseScoreMs),boundMs:Math.round(m.boundCheckMs),eps:Math.round(m.evaluationsPerSecond),top:res.results[0]?.score}))
}
