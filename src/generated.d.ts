// The index that scripts/compile-tools.ts writes: tool name to its compiled validator module, keyed for the provider.
declare module '*/generated/index.mjs' {
  const compiled: Record<string, { name: string; module: unknown }>
  export default compiled
}
