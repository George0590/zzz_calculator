// Diagnostic-only ESM loader: instruments the optimizer core at load time.
// Repository sources are NOT modified; patching happens in memory via module.register().
// Counts the silent "upperBound = +Infinity" early-return paths in
// core/driveDiscOptimizer-core.js so a benchmark can prove why pruning is inert.
export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context)
    if (!url.endsWith("/core/driveDiscOptimizer-core.js")) {
        return result
    }
    let source = typeof result.source === "string"
        ? result.source
        : Buffer.from(result.source ?? "").toString("utf8")
    const before = source.length

    const dbg = (key) => `globalThis.__FIONI_OPT_DBG = globalThis.__FIONI_OPT_DBG || { boundInfinityReleaseInterval: 0, boundInfinityFreeTwoPiece: 0, pruneCalls: 0, pruneCallsWithFiniteCutoff: 0, kernelInfo: [], meta: null, denseTarget: null };\n`

    // 1) capture optimizerStatMetadata
    const metaAnchor = `    const optimizerStatMetadata = typeof panelCalculator.optimizerStatMetadata === "function"
        ? panelCalculator.optimizerStatMetadata({ minimums: settings.minimums })
        : null`
    source = source.replace(metaAnchor, `${metaAnchor}
    ${dbg()}
    globalThis.__FIONI_OPT_DBG.meta = optimizerStatMetadata`)

    // 2) capture the specialized score kernel handed to each super-bound plan
    const kernelAnchor = `    const specializedScoreKernel = maxFreeTwoPieceCount === 0
        ? compileSpecializedPlanScoreKernel(state, completeSetCountsArray, orderedSlots)
        : null`
    source = source.replace(kernelAnchor, `${kernelAnchor}
    ${dbg()}
    globalThis.__FIONI_OPT_DBG.kernelInfo.push({
        completeSetCounts: Array.from(completeSetCountsArray ?? []),
        maxFreeTwoPieceCount,
        hasKernel: !!specializedScoreKernel,
        scoreKernel: specializedScoreKernel?.scoreKernel ?? null,
        releaseIntervalBound: specializedScoreKernel?.releaseIntervalBound ?? null,
        hasScoreScalar: typeof specializedScoreKernel?.scoreScalar === "function",
        hasScoreObjectiveScalar: typeof specializedScoreKernel?.scoreObjectiveScalar === "function",
        hasScoreCombinedScalar: typeof specializedScoreKernel?.scoreCombinedScalar === "function",
    })`)

    // 3) count the release-interval early return (line ~2543) in superBoundScoreDense
    const releaseAnchor = `    if (state.optimizerStatMetadata?.requiresReleaseIntervalBound
        && superPlan.specializedScoreKernel?.releaseIntervalBound !== true) {
        return Number.POSITIVE_INFINITY
    }`
    source = source.replace(releaseAnchor, `    if (state.optimizerStatMetadata?.requiresReleaseIntervalBound
        && superPlan.specializedScoreKernel?.releaseIntervalBound !== true) {
        ${dbg()}
        globalThis.__FIONI_OPT_DBG.boundInfinityReleaseInterval += 1
        return Number.POSITIVE_INFINITY
    }`)

    // 4) count the optimistic-free-two-piece early return in superBoundScoreDense
    const freeAnchor = `    if (superPlan.needsOptimisticFreeTwoPiece && !superPlan.freeTwoPieceOptimisticEntries) {
        return Number.POSITIVE_INFINITY
    }

    const boundCallCount`
    source = source.replace(freeAnchor, `    if (superPlan.needsOptimisticFreeTwoPiece && !superPlan.freeTwoPieceOptimisticEntries) {
        ${dbg()}
        globalThis.__FIONI_OPT_DBG.boundInfinityFreeTwoPiece += 1
        return Number.POSITIVE_INFINITY
    }

    const boundCallCount`)

    // 5) count pruning attempts and whether a finite cutoff existed
    const pruneAnchor = `    const cutoffParts = pruningCutoffScoreParts(state)
    const cutoff = pruningCutoffScore(state)
    if (!Number.isFinite(cutoff)) {
        return { pruned: false, upperBound: Number.POSITIVE_INFINITY }
    }`
    source = source.replace(pruneAnchor, `    const cutoffParts = pruningCutoffScoreParts(state)
    const cutoff = pruningCutoffScore(state)
    ${dbg()}
    globalThis.__FIONI_OPT_DBG.pruneCalls += 1
    if (!Number.isFinite(cutoff)) {
        return { pruned: false, upperBound: Number.POSITIVE_INFINITY }
    }
    globalThis.__FIONI_OPT_DBG.pruneCallsWithFiniteCutoff += 1`)

    if (source.length === before) {
        throw new Error("fioni-engine-instrument-loader: no instrumentation anchor matched")
    }
    return { ...result, source }
}
