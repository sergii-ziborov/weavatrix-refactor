// weavatrix-refactor-js 0.1.6: the LSP-backed JavaScript implementation, same task.
// Its rename seeds a pooled tsserver, so this is the COMPLETE-claiming contender.
const FIXTURE = process.env.REFBENCH_FIXTURE
const BIN = process.env.REFBENCH_JS_BIN

export default {
  name: 'weavatrix-refactor-js-0.1.6',
  command: 'node',
  args: [BIN, FIXTURE],
  cwd: FIXTURE,
  env: { WEAVATRIX_ALLOW_SOURCE_EDITS: '1' },
  initTimeoutMs: 300000,
  steps: [
    {
      tool: 'rename_symbol',
      label: 'rename by bare name',
      arguments: { symbol: 'resolveTarget', new_name: 'locateTarget', output_format: 'json' },
      timeoutMs: 300000,
      capture: (state, result, text) => {
        const start = text.indexOf('{')
        if (start < 0) return
        try {
          const parsed = JSON.parse(text.slice(start))
          state.first = parsed.result ?? parsed
        } catch { /* recorded below */ }
      },
      record: (state, result, text) => (state.first ? { status: state.first.status } : text.slice(0, 120)),
    },
    {
      tool: 'rename_symbol',
      label: 'rename by file#name@line (the refusal names the format)',
      arguments: { symbol: 'src/core.ts#resolveTarget@2', new_name: 'locateTarget', output_format: 'json' },
      timeoutMs: 300000,
      capture: (state, result, text) => {
        const start = text.indexOf('{')
        if (start < 0) return
        try {
          const parsed = JSON.parse(text.slice(start))
          const inner = parsed.result ?? parsed
          state.token = inner.confirmToken ?? null
          state.second = {
            status: inner.status,
            completeness: inner.planning ? inner.planning.completeness : undefined,
            warnings: inner.planning ? inner.planning.warnings : undefined,
          }
        } catch { /* recorded */ }
      },
      record: (state) => state.second ?? 'no parse',
    },
    {
      tool: 'rename_symbol',
      label: 'apply with the token',
      arguments: (state) => state.token
        ? {
            symbol: 'src/core.ts#resolveTarget@2',
            new_name: 'locateTarget',
            mode: 'apply',
            confirm_token: state.token,
            output_format: 'json',
          }
        : null,
      timeoutMs: 300000,
      record: (state, result, text) => {
        const match = text.match(/"status"\s*:\s*"([A-Z_]+)"/)
        return match ? match[1] : text.slice(0, 120)
      },
    },
  ],
}
