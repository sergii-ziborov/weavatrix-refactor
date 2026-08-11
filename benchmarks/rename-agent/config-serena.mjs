// Serena over MCP stdio, same task, same honest flow: the bare name is ambiguous
// (two declarations), so the agent first finds the symbol, then renames the right one.
// Serena's rename_symbol is LSP-backed and writes files directly - no preview, no token.
const FIXTURE = process.env.REFBENCH_FIXTURE

export default {
  name: 'serena',
  command: 'uvx',
  args: [
    '--from', 'git+https://github.com/oraios/serena',
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
      arguments: { name_path: 'resolveTarget' },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 160),
    },
    {
      tool: 'rename_symbol',
      label: 'LSP rename',
      arguments: { name_path: 'resolveTarget', relative_path: 'src/core.ts', new_name: 'locateTarget' },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 160),
    },
  ],
}
