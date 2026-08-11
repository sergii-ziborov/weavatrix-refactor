// weavatrix-refactor 1.0.4: the flow after the benchmark's own findings were fixed.
// The ambiguous refusal now carries candidates (no graph query), and the apply
// presents only its token (no plan echo). 4 calls total.
const FIXTURE = process.env.REFBENCH_FIXTURE
const EXE = process.env.REFBENCH_WEAVATRIX_EXE

export default {
  name: 'weavatrix-refactor-1.0.4',
  command: EXE,
  args: ['mcp', FIXTURE],
  cwd: FIXTURE,
  env: { WEAVATRIX_ALLOW_SOURCE_EDITS: '1' },
  steps: [
    {
      tool: 'rename_symbol',
      label: 'rename by bare name (refusal carries candidates)',
      arguments: { symbol: 'resolveTarget', new_name: 'locateTarget', output_format: 'json' },
      capture: (state, result, text) => {
        const match = text.match(/"candidates"\s*:\s*\[([^\]]*)\]/)
        if (!match) return
        const ids = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
        state.id = ids.find((id) => id.includes('core.ts')) ?? null
      },
      record: (state) => (state.id ? `candidate: ${state.id}` : 'NO CANDIDATES'),
    },
    {
      tool: 'rename_symbol',
      label: 'rename by candidate id',
      arguments: (state) => state.id
        ? { symbol: state.id, new_name: 'locateTarget', output_format: 'json' }
        : null,
      capture: (state, result, text) => {
        const start = text.indexOf('{')
        if (start < 0) return
        try {
          const parsed = JSON.parse(text.slice(start))
          state.plan = parsed.plan ?? null
          state.renameAnswer = { status: parsed.status, edits: parsed.renamedEdits, uncertain: (parsed.uncertainReferences ?? []).length }
        } catch { /* recorded */ }
      },
      record: (state) => state.renameAnswer,
    },
    {
      tool: 'apply_edit_plan',
      label: 'preview',
      arguments: (state) => state.plan ? { plan: state.plan, output_format: 'json' } : null,
      capture: (state, result, text) => {
        const match = text.match(/"confirmToken"\s*:\s*"([^"]+)"/)
        state.token = match ? match[1] : null
      },
      record: (state) => (state.token ? 'token issued' : 'NO TOKEN'),
    },
    {
      tool: 'apply_edit_plan',
      label: 'apply with the token alone',
      arguments: (state) => state.token
        ? { mode: 'apply', confirm_token: state.token, output_format: 'json' }
        : null,
      record: (state, result, text) => {
        const match = text.match(/"status"\s*:\s*"([A-Z_]+)"/)
        return match ? match[1] : text.slice(0, 100)
      },
    },
  ],
}
