// Serena over MCP stdio, same task, same honest flow: the bare name is ambiguous
// (two declarations), so the agent first finds the symbol, then renames the right one.
// Serena's rename_symbol is LSP-backed and writes files directly - no preview, no token.
const FIXTURE = process.env.REFBENCH_FIXTURE
const LANGUAGE = process.env.REFBENCH_LANGUAGE ?? 'typescript'
const SERENA_COMMIT = 'f1d78a88cec2031d6b699c9944839979e9a0175d'
const SPEC = {
  typescript: { oldName: 'resolveTarget', newName: 'locateTarget', declaringFile: 'src/core.ts' },
  rust: { oldName: 'resolve_target', newName: 'locate_target', declaringFile: 'src/core.rs' },
  python: { oldName: 'resolve_target', newName: 'locate_target', declaringFile: 'src/core.py' },
}[LANGUAGE]

if (!SPEC) throw new Error(`unsupported REFBENCH_LANGUAGE: ${LANGUAGE}`)

export default {
  name: `serena-${SERENA_COMMIT.slice(0, 8)}-${LANGUAGE}`,
  command: 'uvx',
  args: [
    '--from', `git+https://github.com/oraios/serena@${SERENA_COMMIT}`,
    'serena', 'start-mcp-server',
    '--project', FIXTURE,
    '--context', 'ide-assistant',
    '--enable-web-dashboard', 'false',
    '--enable-gui-log-window', 'false',
  ],
  cwd: FIXTURE,
  initTimeoutMs: 600000,
  steps: [
    {
      tool: 'find_symbol',
      label: 'disambiguate the symbol',
      arguments: { name_path: SPEC.oldName },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 160),
    },
    {
      tool: 'rename_symbol',
      label: 'LSP rename',
      arguments: { name_path: SPEC.oldName, relative_path: SPEC.declaringFile, new_name: SPEC.newName },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 160),
    },
  ],
}
