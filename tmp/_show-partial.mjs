import fs from "node:fs"
const raw = JSON.parse(fs.readFileSync("tmp/fioni-perf-raw.json","utf8"))
for (const c of raw.cases) {
  if (!c.label.startsWith("real_partial")) continue
  console.log(JSON.stringify({label:c.label, elapsed:c.elapsedMsAll, prepMs:c.prepMsMedian, percent:c.percentDone, preview:c.previewMetrics && {estimated:c.previewMetrics.estimatedCombinationCount, candidateCountsBySlot:c.previewMetrics.candidateCountsBySlot, planCount:c.previewMetrics.enumerationPlanCount}, samples:c.progressSamples, metrics:c.metrics},null,1).slice(0,4000))
}
