# weavatrix-refactor

The refactoring layer of Weavatrix — **the only component that writes code.**

It sits in the middle of the stack: `weavatrix-online ⊃ weavatrix-refactor ⊃
weavatrix`. Install this one package and you get the full read-only
[weavatrix](https://github.com/sergii-ziborov/weavatrix) core (34 offline
analysis tools) plus the 11 tools that turn its proven analysis into applied,
reversible edits.

## Why this is a separate package

The core is **safe by design**: the published MIT artifact contains no
source-writing paths and no network paths, and release gates verify both claims
on every release. The core can *compute and prove* a refactoring — it can never
*apply* one.

Writing code is this package's whole job, and its name says so. If
`weavatrix-refactor` is not installed, your Weavatrix server is physically
incapable of modifying your code. Installing it is the explicit, visible consent
step.

## How it works

1. A **plan producer** in this layer (read-only) computes an **edit plan**
   against the core's read-only analysis surface (`weavatrix/analysis-kit`):
   exact file ranges, before/after text, a sha256 of every target file, honest
   provenance tiers per edit, and a short-lived `confirm_token`. Only proven
   tiers are applyable.
2. `apply_edit_plan(confirm_token)` re-verifies every file hash under a lock,
   applies the edits bottom-up, and writes a rollback bundle first. Any drift or
   mid-apply failure rolls back and reports it.
3. The graph refreshes and `verified_change` runs as the post-apply proof.

This package never invents edits. It executes only plans it computed, proved, and
hashed against the read-only core.

## Tools

**Plan producers** (read-only, emit `weavatrix.edit-plan.v1`):

| Tool | Purpose |
| --- | --- |
| `rename_symbol` | Rename a symbol and every reference (LSP, SQL, or graph-resolved by language) |
| `rename_related_symbols` | Rename a symbol together with its naming-convention siblings |
| `move_file` | Move a file and rewrite every import/reference to it |
| `move_symbol` | Move a symbol to another module and rewire its references |
| `delete_readiness` | Prove whether a symbol is safe to delete and what still references it |
| `change_signature` | Change a function/method signature and update call sites |
| `edit_symbol` | Replace a symbol's body with a hash-bound edit |
| `bulk_replace` | Apply a proven, reference-aware bulk replacement |
| `organize_imports` | Sort and prune imports deterministically |

**Appliers** (write code, gated):

| Tool | Purpose |
| --- | --- |
| `apply_edit_plan` | Apply a hash-bound edit plan (preview → single-use confirm token → atomic apply) |
| `rollback_last_apply` | Restore the pre-apply state from the rollback bundle; retries converge, never wedge |

Gating (all three required to write anything): this package installed and its
`refactor` profile selected · `WEAVATRIX_ALLOW_SOURCE_EDITS=1` in the
environment · a valid, unexpired `confirm_token` bound to the exact file hashes
of the plan.

## Install

```bash
npx weavatrix-refactor <repoRoot>
```

Or wire it as an MCP server (stdio). Set `WEAVATRIX_ALLOW_SOURCE_EDITS=1` only
when you want the apply tools to be able to write.

## Relationship to the Weavatrix family

| Package | License | Nature |
| --- | --- | --- |
| `weavatrix` | MIT | Read-only analysis, previews, evidence — cannot write |
| `weavatrix-refactor` | Apache-2.0 | **Writes code** — produces and applies proven plans, with rollback |
| `weavatrix-online` | WOSL 1.0 | Paid intelligence — composes this layer, adds sync and advisories |

It extends the MIT engine through its supported extension API
(`weavatrix/extension-api`) and read-only analysis surface
(`weavatrix/analysis-kit`); it does not copy or relicense core code.

## License

Apache-2.0 — chosen deliberately for a code-writing tool: explicit patent grant
and the formal warranty/liability terms of sections 7–8.
