// weavatrix-refactor 1.0.5: direct, documented rename workflow.
// An ambiguous name returns candidates. The exact retry produces a hash-bound
// preview and token; repeating rename_symbol with that token applies the plan.
const FIXTURE = process.env.REFBENCH_FIXTURE
const EXE = process.env.REFBENCH_WEAVATRIX_EXE
const LANGUAGE = process.env.REFBENCH_LANGUAGE ?? 'typescript'
const SPEC = {
  typescript: { oldName: 'resolveTarget', newName: 'locateTarget', declaringFile: 'src/core.ts' },
  rust: { oldName: 'resolve_target', newName: 'locate_target', declaringFile: 'src/core.rs' },
  python: { oldName: 'resolve_target', newName: 'locate_target', declaringFile: 'src/core.py' },
}[LANGUAGE]

if (!SPEC) throw new Error(`unsupported REFBENCH_LANGUAGE: ${LANGUAGE}`)

function parsedResult(text) {
  const start = text.indexOf('{')
  if (start < 0) return null
  try { return JSON.parse(text.slice(start)) } catch { return null }
}

export default {
  name: `weavatrix-refactor-1.0.5-${LANGUAGE}`,
  command: EXE,
  args: ['mcp', FIXTURE],
  cwd: FIXTURE,
  env: { WEAVATRIX_ALLOW_SOURCE_EDITS: '1' },
  steps: [
    {
      tool: 'rename_symbol',
      label: 'rename by bare name (refusal carries candidates)',
      arguments: { symbol: SPEC.oldName, new_name: SPEC.newName, output_format: 'json' },
      capture: (state, result, text) => {
        const parsed = parsedResult(text)
        const ids = parsed?.candidates ?? []
        state.id = ids.find((id) => id.includes(SPEC.declaringFile)) ?? null
      },
      record: (state) => (state.id ? `candidate: ${state.id}` : 'NO CANDIDATES'),
    },
    {
      tool: 'rename_symbol',
      label: 'preview exact rename',
      arguments: (state) => state.id
        ? { symbol: state.id, new_name: SPEC.newName, output_format: 'json' }
        : null,
      capture: (state, result, text) => {
        const parsed = parsedResult(text)
        state.token = parsed?.confirmToken ?? null
        state.preview = parsed
          ? {
              status: parsed.status,
              edits: parsed.renamedEdits,
              uncertain: (parsed.uncertainReferences ?? []).length,
              tokenIssued: Boolean(state.token),
            }
          : null
      },
      record: (state) => state.preview ?? 'NO PREVIEW',
    },
    {
      tool: 'rename_symbol',
      label: 'apply exact rename with preview token',
      arguments: (state) => state.id && state.token
        ? {
            symbol: state.id,
            new_name: SPEC.newName,
            mode: 'apply',
            confirm_token: state.token,
            output_format: 'json',
          }
        : null,
      record: (state, result, text) => parsedResult(text)?.status ?? text.slice(0, 100),
    },
  ],
}
