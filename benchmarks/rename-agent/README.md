# Rename agent benchmark

This directory is the reproducible evidence behind
[`docs/benchmarks/refactor-vs-competitors-2026-08.md`](../../docs/benchmarks/refactor-vs-competitors-2026-08.md).
It deliberately keeps two measurements separate:

1. **MCP protocol layer:** scripted, deterministic calls; exact o200k tokens for
   server initialization, tool catalogs, requests, and responses; measured
   server wall time in milliseconds.
2. **Naked Codex agent:** a real model-driven coding-agent run with no MCP
   server; cumulative usage from `turn.completed`, end-to-end wall time in
   milliseconds, and the same 12-check grader.

The first excludes model planning and the common coding-agent host. The second
includes both. They answer different questions and must not be merged by adding
an assumed tokens-per-second conversion to the MCP times.

## Fixture and correctness

The TypeScript fixture contains seven required edits, four traps, and one build
gate. Run the grader against any edited fixture with:

```powershell
npm.cmd install --ignore-scripts --no-audit --no-fund --prefix fixture
node verify.mjs fixture
```

A valid result is `score: 12/12`.

## MCP protocol runs

Install this harness once:

```powershell
npm.cmd ci
```

Set the fixture and contender paths, then capture three clean copies per
contender. `REFBENCH_CAPTURE=1` is required for token counting:

```powershell
$env:REFBENCH_CAPTURE = '1'
$env:REFBENCH_FIXTURE = (Resolve-Path fixture).Path
$env:REFBENCH_WEAVATRIX_EXE = 'C:\path\to\weavatrix-refactor.exe'
$env:REFBENCH_JS_BIN = 'C:\path\to\weavatrix-refactor-js\src\index.js'
node driver.mjs (Resolve-Path config-weavatrix-104.mjs) results\raw\wvxr104-run1.json
```

Restore the fixture before each run. `config-js.mjs`, `config-serena.mjs`, and
`config-serena-warm.mjs` define the other exact flows. Measure the one-time MCP
cost with `fixed-cost.mjs`; it counts the complete initialize response (whose
instructions are also reported as a subset) plus `tools/list`:

```powershell
$env:REFBENCH_FIXTURE = (Resolve-Path fixture).Path
node fixed-cost.mjs weavatrix results\raw\fixed-wvxr.json $env:REFBENCH_WEAVATRIX_EXE mcp $env:REFBENCH_FIXTURE
```

## Real naked Codex runs

`run-codex-naked.ps1` copies the bundled CLI and its command host out of the
WindowsApps directory because direct execution is blocked on this Windows
installation. Each run uses a fresh temporary Git repository and invokes
Codex with no user config, rules, or MCP servers:

```powershell
.\run-codex-naked.ps1 -Runs 3 -OutputDirectory results\local-codex
```

The script uses `--dangerously-bypass-approvals-and-sandbox` only inside the
new temporary fixture directory; do not point it at a real repository. Pass
`-Model <id>` when model pinning is required. The captured 2026-08-11 CLI event
stream did not expose its default model id, so the checked-in result names the
CLI version and that limitation instead of guessing.

## Rebuild the checked-in summary

```powershell
npm.cmd run summarize
```

The output is `results/2026-08-11-summary.json`. Raw captures are retained under
`results/raw/`; byte fields there are transport diagnostics, not token proxies.
