import fs from "node:fs"
const s = fs.readFileSync("core/driveDiscOptimizer-core.js","utf8")
const pats = [
"const specializedScoreKernel = maxFreeTwoPieceCount === 0",
"if (superPlan.needsOptimisticFreeTwoPiece && !superPlan.freeTwoPieceOptimisticEntries) {",
"if (state.optimizerStatMetadata?.requiresReleaseIntervalBound",
"if (!Number.isFinite(cutoff)) {",
"const optimizerStatMetadata = typeof panelCalculator.optimizerStatMetadata === \"function\"",
]
for (const p of pats) console.log(s.split(p).length - 1, JSON.stringify(p.slice(0,70)))
