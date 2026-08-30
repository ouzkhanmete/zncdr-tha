// One place to import any endpoint call from. Every module here follows the same shape: a plain
// function per call in docs/api.md, taking a params object and returning a promise of the exact
// `@app/shared` response type -- see client.ts for the one `fetch()` they all share.
export * from "./client.ts"
export * from "./lookup.ts"
export * from "./metrics.ts"
export * from "./flags.ts"
export * from "./budget.ts"
export * from "./comparison.ts"
export * from "./trend.ts"
export * from "./engineers.ts"
export * from "./runs.ts"
