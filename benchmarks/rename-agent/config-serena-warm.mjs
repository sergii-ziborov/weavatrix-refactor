// Serena with a deliberate warm-up: touch every file through the language server first,
// so the cross-file program is loaded before the rename. This is the generous variant -
// an agent would have to know to do this.
const FIXTURE = process.env.REFBENCH_FIXTURE

export default {
  name: 'serena-warm',
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
      tool: 'get_diagnostics_for_file',
      label: 'warm caller.ts',
      arguments: { relative_path: 'src/caller.ts' },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 80),
    },
    {
      tool: 'get_diagnostics_for_file',
      label: 'warm toplevel.ts',
      arguments: { relative_path: 'src/toplevel.ts' },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 80),
    },
    {
      tool: 'find_symbol',
      label: 'disambiguate the symbol',
      arguments: { name_path: 'resolveTarget' },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 120),
    },
    {
      tool: 'find_referencing_symbols',
      label: 'force cross-file reference index',
      arguments: { name_path: 'resolveTarget', relative_path: 'src/core.ts' },
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
