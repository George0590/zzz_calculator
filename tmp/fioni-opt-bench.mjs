import { loadCalculatorContext } from '../backend/calculator.js'
import { optimizeDriveDiscsAsync } from '../backend/driveDiscOptimizer.js'
import { fioniOptimizerInput } from '../tests/fixtures/fioni-optimizer.js'

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const catalog = await loadCalculatorContext(root)

// Realistic-ish synthetic inventory: N sets x V variants per slot
function makeStore(sets, variants) {
    const mains = [null, ['hpFlat', 2200], ['atkFlat', 316], ['defFlat', 184], ['anomalyProficiency', 92], ['fireDmg', 30], ['atkPct', 30]]
    const subPool = ['critRate', 'critDmg', 'atkPct', 'anomalyProficiency', 'penRatio', 'atkFlat', 'anomalyMastery']
    const driveDiscs = []
    for (let slot = 1; slot <= 6; slot++) {
        for (let setIndex = 0; setIndex < sets.length; setIndex++) {
            for (let variant = 0; variant < variants; variant++) {
                const subs = []
                for (let s = 0; s < 4; s++) {
                    const stat = subPool[(variant + s + slot + setIndex) % subPool.length]
                    if (stat === mains[slot][0]) continue
                    subs.push({ stat, value: stat === 'critRate' ? 2.4 + (variant % 4) * 1.2 : stat === 'critDmg' ? 4.8 + (variant % 5) * 2.4 : stat === 'atkFlat' ? 19 + (variant % 5) * 19 : stat === 'anomalyProficiency' ? 9 + (variant % 5) * 9 : stat === 'anomalyMastery' ? 6 + (variant % 3) * 6 : 3 + (variant % 5) * 1.5 })
                }
                driveDiscs.push({ id: `${slot}-${setIndex}-${variant}`, ownerId: 'default', partition: slot, setId: sets[setIndex], rarity: 'S', level: 15, maxLevel: 15, mainStat: { stat: mains[slot][0], value: mains[slot][1] }, subStats: subs, source: { type: 'test', sequence: slot * 1000 + setIndex * 100 + variant } })
            }
        }
    }
    return { version: 1, currentOwnerId: 'default', owners: [{ id: 'default', label: 'Synthetic' }], imports: [], driveDiscLoadouts: [], driveDiscs }
}

const scenarios = [
    { label: 'fioni-2sets-4var (24/slot)', sets: ['phaethons_melody', 'hormone_punk'], variants: 4 },
    { label: 'fioni-3sets-6var (54/slot)', sets: ['phaethons_melody', 'hormone_punk', 'woodpecker_electro'], variants: 6 },
]

const base = fioniOptimizerInput()
for (const scene of scenarios) {
    const store = makeStore(scene.sets, scene.variants)
    const request = structuredClone(base)
    request.settings = { ...request.settings, fourPieceSetId: scene.sets[0], twoPieceSetId: scene.sets[1] }
    const startedAt = Date.now()
    const result = await optimizeDriveDiscsAsync(catalog, store, request)
    const ms = Date.now() - startedAt
    const m = result.metrics ?? {}
    console.log(`\n=== ${scene.label} ===`)
    console.log(`time=${ms}ms status=${result.status} combos=${m.evaluatedCombinations} est=${m.estimatedCombinationCount} leavesPruned=${m.prunedLeafCount ?? 'n/a'}`)
    console.log(`boundChecks: super=${m.superBoundChecks} suffixTopK=${m.suffixTopKBoundChecks ?? 'n/a'}`)
    console.log(`kernel: ${m.scoreKernel ?? 'n/a'} objectiveScalarCalls=${m.objectiveScalarCalls} objectiveScalarPlanCount=${m.objectiveScalarPlanCount} objectiveScalarFallbacks=${m.objectiveScalarFallbacks} fallbackReason=${m.objectiveScalarFallbackReason}`)
    console.log(`indexedSearch=${m.useIndexedSearch ?? 'n/a'} compiledDense=${m.useCompiledDenseScore ?? 'n/a'} strictMonotonic=${m.strictMonotonic ?? 'n/a'} requiresReleaseIntervalBound=${m.requiresReleaseIntervalBound ?? 'n/a'}`)
    console.log(`metrics keys sample:`, Object.keys(m).filter(k => /fallback|prune|bound|kernel|scalar/i.test(k)).map(k => `${k}=${m[k]}`).join(' '))
}
process.exit(0)
