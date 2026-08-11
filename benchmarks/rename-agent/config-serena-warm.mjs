// Serena with a deliberate warm-up: touch every file through the language server first,
// so the cross-file program is loaded before the rename. This is the generous variant -
// an agent would have to know to do this.
const FIXTURE = process.env.REFBENCH_FIXTURE
const LANGUAGE = process.env.REFBENCH_LANGUAGE ?? 'typescript'
const SERENA_COMMIT = 'f1d78a88cec2031d6b699c9944839979e9a0175d'
const SPEC = {
  typescript: {
    oldName: 'resolveTarget', newName: 'locateTarget', declaringFile: 'src/core.ts',
    warmFiles: ['src/caller.ts', 'src/toplevel.ts'],
  },
  rust: {
    oldName: 'resolve_target', newName: 'locate_target', declaringFile: 'src/core.rs',
    warmFiles: ['src/caller.rs', 'src/toplevel.rs'],
  },
  python: {
    oldName: 'resolve_target', newName: 'locate_target', declaringFile: 'src/core.py',
    warmFiles: ['src/caller.py', 'src/toplevel.py'],
  },
}[LANGUAGE]

if (!SPEC) throw new Error(`unsupported REFBENCH_LANGUAGE: ${LANGUAGE}`)

export default {
  name: `serena-warm-${SERENA_COMMIT.slice(0, 8)}-${LANGUAGE}`,
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
      tool: 'get_diagnostics_for_file',
      label: `warm ${SPEC.warmFiles[0]}`,
      arguments: { relative_path: SPEC.warmFiles[0] },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 80),
    },
    {
      tool: 'get_diagnostics_for_file',
      label: `warm ${SPEC.warmFiles[1]}`,
      arguments: { relative_path: SPEC.warmFiles[1] },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 80),
    },
    {
      tool: 'find_symbol',
      label: 'disambiguate the symbol',
      arguments: { name_path: SPEC.oldName },
      timeoutMs: 300000,
      record: (state, result, text) => text.slice(0, 120),
    },
    {
      tool: 'find_referencing_symbols',
      label: 'force cross-file reference index',
      arguments: { name_path: SPEC.oldName, relative_path: SPEC.declaringFile },
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
