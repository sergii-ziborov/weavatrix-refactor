# weavatrix-refactor

The refactoring layer of Weavatrix — **the only component that writes code.**

Install this one package and you get the full read-only
[weavatrix](https://github.com/sergii-ziborov/weavatrix) core (34 offline
analysis tools) plus the 11 tools that turn its proven analysis into applied,
reversible edits.

## Why this is a separate package

The core is **safe by design**: the published MIT artifact contains no
source-writing paths and no network paths, and release gates verify both claims
on every release. This layer's read-only plan producers *compute and prove* a
refactoring against the core's analysis; nothing in the family *applies* one
until the apply tools here are invoked.

Writing code is this package's whole job, and its name says so. If
`weavatrix-refactor` is not installed, your Weavatrix server is physically
incapable of modifying your code. Installing it is the explicit, visible consent
step.

## How it works

1. A **plan producer** in this layer (read-only) computes an **edit plan** (a
   `weavatrix.edit-plan.v1` envelope) against the core's read-only analysis
   surface (`weavatrix/analysis-kit`): exact file ranges, before/after text, a
   sha256 of every target file, and honest provenance tiers per edit. Only
   proven tiers are applyable.
2. `apply_edit_plan` runs in two modes. `mode="preview"` (the default)
   re-verifies every file hash and `before` text against the working tree and,
   on a clean match, issues a single-use, short-lived `confirm_token`.
   `mode="apply"` with that token consumes it, re-checks under a lock, writes a
   rollback bundle first, and applies the edits bottom-up. Any drift or mid-apply
   failure rolls back and reports it.
3. The graph refreshes and `verified_change` runs as the post-apply proof.

This package never invents edits. It executes only plans it computed, proved, and
hashed against the read-only core.

## Tools

**Plan producers** (read-only) — most emit an applyable `weavatrix.edit-plan.v1`; `move_file`, `move_symbol`, and `delete_readiness` instead emit a review plan / dry-run / verdict you act on directly, not an apply envelope:

| Tool | Purpose |
| --- | --- |
| `rename_symbol` | Rename a symbol and every reference (LSP, SQL, or graph-resolved by language) |
| `rename_related_symbols` | Coordinate several JS/TS renames as one atomic plan with conflict/chain/swap detection |
| `move_file` | Move a file and rewrite every import/reference to it |
| `move_symbol` | Dry-run a symbol move: predicted cycles, architecture violations and blast radius (you apply the move) |
| `delete_readiness` | Prove whether a symbol is safe to delete and what still references it |
| `change_signature` | Change a function/method signature and update call sites |
| `edit_symbol` | Replace a symbol's body, or insert before/after it, over the parser range |
| `bulk_replace` | Occurrence-selective, hash-proven bulk pattern replacement (literal by default) |
| `organize_imports` | Prune provably-unused named imports (sorting left to the formatter) |

**Appliers** (write code, gated):

| Tool | Purpose |
| --- | --- |
| `apply_edit_plan` | Apply a hash-bound edit plan (preview → single-use confirm token → atomic apply) |
| `rollback_last_apply` | Restore the pre-apply state from the rollback bundle; retries converge, never wedge |

Gating: writing repository source requires two gates, and both appliers sit
behind them — this package installed with its `refactor` profile selected (the
`edit` capability) and `WEAVATRIX_ALLOW_SOURCE_EDITS=1` in the environment.
`apply_edit_plan` additionally requires a valid, unexpired `confirm_token` bound
to the exact file hashes of the plan; `rollback_last_apply` restores the
pre-apply state from the last rollback bundle and takes no token.

## What you also get from the core

Installing `weavatrix-refactor` bundles the full MIT `weavatrix` core — all 34
read-only tools, unchanged — in the same MCP server. The refactoring tools above
build directly on them:

- **Understand** — `module_map`, `list_communities`, `god_nodes`, `query_graph`, `shortest_path`, `search_code`, `read_source`, `inspect_symbol`, `context_bundle`
- **Impact & safety** — `change_impact`, `get_dependents`, `coverage_map`, `hot_path_review`, `prepare_change`, `verified_change`
- **Health & evidence** — `run_audit`, `find_dead_code`, `find_duplicates`, `git_history`, `graph_diff`
- **Endpoints & contracts** — `list_endpoints`, `trace_endpoint`, `trace_api_contract`
- **Architecture** — `get_architecture_contract`, `verify_architecture`, `explain_architecture_violation`, `propose_architecture_exception`
- **Graph & repos** — `graph_stats`, `get_node`, `get_neighbors`, `get_community`, `rebuild_graph`, `open_repo`, `list_known_repos`

See the [weavatrix README](https://github.com/sergii-ziborov/weavatrix) for the full core reference.

## Install

```bash
npx -y weavatrix-refactor <repoRoot>
```

Or wire it as an MCP server (stdio). Set `WEAVATRIX_ALLOW_SOURCE_EDITS=1` only
when you want the apply tools to be able to write.

## Relationship to the core

| Package | License | Nature |
| --- | --- | --- |
| `weavatrix` | MIT | Read-only analysis, previews, evidence — cannot write |
| `weavatrix-refactor` | Apache-2.0 | **Writes code** — produces and applies proven plans, with rollback |

It extends the MIT engine through its supported extension API
(`weavatrix/extension-api`) and read-only analysis surface
(`weavatrix/analysis-kit`); it does not copy or relicense core code.

## License

Apache-2.0 — chosen deliberately for a code-writing tool: explicit patent grant
and the formal warranty/liability terms of sections 7–8.
