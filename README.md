# weavatrix-refactor

> **Status: pre-release, not yet published to npm.** The apply side
> (`apply_edit_plan`, `rollback_last_apply`) is implemented and tested (41 tests,
> including a live stdio end-to-end run). The core preview tools that produce
> edit plans are still landing in the `weavatrix` core and are not released yet.

The only Weavatrix component that writes code.

## Why this is a separate package

The [weavatrix](https://github.com/sergii-ziborov/weavatrix) core is **safe by
design**: the published MIT artifact contains no source-writing paths (and no
network paths), and release gates verify both claims on every release. The core
can *compute and prove* a refactoring — it can never *apply* one.

Applying edits is this package's whole job, and its name says so. If
`weavatrix-refactor` is not installed, your Weavatrix server is physically
incapable of modifying your code. Installing it is the explicit, visible
consent step.

## How it works

1. A core preview tool (`rename_symbol`, `move_symbol`, `delete_readiness`,
   `change_signature` — all read-only) computes an **edit plan**: exact file
   ranges, before/after text, a sha256 of every target file, honest
   uncertainty labels (`uncertainReferences`, `notModified` with reasons), and
   a short-lived `confirm_token`.
2. `apply_edit_plan(confirm_token)` (this package) re-verifies every file hash
   under a lock, applies the edits bottom-up, and writes a rollback bundle
   first. Any drift or mid-apply failure rolls back and reports it.
3. The graph refreshes and `verified_change` runs automatically as the
   post-apply proof.

This package never invents edits. It executes only plans the read-only core
computed, proved, and hashed.

## Tools

| Tool | Status | Purpose |
| --- | --- | --- |
| `apply_edit_plan` | implemented | Apply a hash-bound edit plan issued by a core preview tool (preview → single-use confirm token → atomic apply) |
| `rollback_last_apply` | implemented | Restore the pre-apply state from the rollback bundle; retries converge, never wedge |

Gating (all three required to write anything): this package installed and its
`refactor` profile selected · `WEAVATRIX_ALLOW_SOURCE_EDITS=1` in the
environment · a valid, unexpired `confirm_token` bound to the exact file
hashes of the plan.

## Relationship to the Weavatrix family

| Package | License | Nature |
| --- | --- | --- |
| `weavatrix` | MIT | Read-only analysis, previews, evidence — cannot write |
| `weavatrix-refactor` | Apache-2.0 | **Writes code** — applies proven plans, with rollback |
| `weavatrix-online` | WOSL 1.0 | Paid intelligence (`plan_refactor`, sync, advisories) |

It extends the MIT engine through its supported extension API
(`weavatrix/extension-api`); it does not copy or relicense core code.

## License

Apache-2.0 — chosen deliberately for a code-writing tool: explicit patent
grant and the formal warranty/liability terms of sections 7–8.
