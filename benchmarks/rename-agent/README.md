# Rename agent benchmark

This directory contains the reproducible evidence behind
[`docs/benchmarks/refactor-vs-competitors-2026-08.md`](../../docs/benchmarks/refactor-vs-competitors-2026-08.md).

## What is measured

The TypeScript, Rust, and Python fixtures have the same ground truth: seven
required edits, four untouched traps, and one build/test gate. The unified
grader reports a score out of 12:

```powershell
node verify.mjs typescript fixture
node verify.mjs rust fixtures\rust
node verify.mjs python fixtures\python
```

The harness keeps two evidence layers separate:

1. Protocol runs execute fixed MCP flows without a model. `driver.mjs` records
   real startup/tool time in milliseconds and exact `o200k_base` tokens for
   initialization, the catalog, requests, and responses.
2. Agent runs execute Codex end to end. `turn.completed` supplies cumulative
   input, cached input, output, and reasoning-output tokens. MCP catalog and
   instructions are already inside that usage and are not added again.

Tool arms fail closed unless their sanitized event audit contains the expected
MCP `rename_symbol` call and contains neither a manual file-change event nor a
source-writing command. Checked-in reports retain only server/tool names and
counts; arguments, results, paths, event streams, and patches stay local.

Byte fields in raw protocol JSON are transport diagnostics only.

## Install the harness

```powershell
npm.cmd ci
npm.cmd test
```

## Protocol matrix

Each run gets a clean fixture. Serena is pinned to commit
`f1d78a88cec2031d6b699c9944839979e9a0175d`.

```powershell
.\run-protocol-matrix.ps1 `
  -Runs 3 `
  -WeavatrixExecutable C:\path\to\weavatrix-refactor-1.0.5.exe
```

To measure the 1.0.6 rename-only surface:

```powershell
.\run-protocol-matrix.ps1 `
  -Runs 3 `
  -Arms weavatrix `
  -WeavatrixExecutable C:\path\to\weavatrix-refactor-1.0.6.exe `
  -WeavatrixConfig (Resolve-Path .\config-weavatrix-106-rename.mjs) `
  -OutputDirectory results\2026-08-11-v2\protocol-rename-profile
```

`config-serena.mjs` is the suggested lookup/rename flow.
`config-serena-warm.mjs` deliberately performs diagnostics and reference
warm-up first; it is a generous comparator, not Serena's two-call baseline.

## Real agent matrix

The runner copies the bundled Codex CLI and companion command host out of the
WindowsApps directory, creates a fresh temporary Git repository per run, and
pins `gpt-5.6-sol` with medium reasoning by default:

```powershell
.\run-agent-matrix.ps1 `
  -Runs 3 `
  -WeavatrixExecutable C:\path\to\weavatrix-refactor-1.0.5.exe
```

The three arms are `naked`, `weavatrix`, and `serena`; the three languages are
`typescript`, `rust`, and `python`. The bypass flag is used only inside those
new temporary fixtures. Do not point the script at a real repository.

The rename-profile A/B is:

```powershell
.\run-agent-matrix.ps1 `
  -Runs 3 `
  -Arms weavatrix `
  -Languages typescript `
  -WeavatrixExecutable C:\path\to\weavatrix-refactor-1.0.6.exe `
  -WeavatrixProfile rename `
  -WeavatrixVersion 1.0.6 `
  -OutputDirectory results\2026-08-11-v2\agent-rename-profile-guided
```

Each checked-in JSON report contains the exact prompt, model, effort, wall
time, usage, and grader checks. Full event streams and working-tree patches
remain local and are ignored.

## Rebuild summaries

```powershell
npm.cmd run summarize
node summarize-v2.mjs `
  results\2026-08-11-v2\protocol-rename-profile `
  results\2026-08-11-v2\agent-rename-profile-guided `
  results\2026-08-11-v2\rename-profile-summary.json
```

The checked-in full matrix contains 27 protocol and 27 agent runs. The profile
addendum contains nine protocol and three guided agent runs.
