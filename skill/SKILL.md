---
name: weavatrix-refactor
description: "Apply hash-verified refactoring edit plans: a weavatrix-refactor plan producer computes and proves a plan against the read-only core, then apply_edit_plan previews it (issuing a confirm token), applies with automatic rollback, and verified_change proves it. The only Weavatrix component that writes code."
---

# weavatrix-refactor MCP

The write-side layer of the Weavatrix stack. The MIT `weavatrix` core is safe by design: its
published artifact contains no source-writing paths. This package's read-only plan producers
*compute and prove* a refactoring against the core's `weavatrix/analysis-kit` surface, and its
apply tools are the only thing in the family that *writes* — applying **only** plans it computed,
proved, and hashed, never inventing edits of its own.

## Step 0 — if the tools are missing

Tools are named `mcp__weavatrix__…` (one merged catalog: core tools plus this extension). If
`apply_edit_plan` is absent, either this package is not installed, its `refactor` profile is not
selected, or the write gate is closed. Register with:
`claude mcp add -s user weavatrix -- npx -y weavatrix-refactor <repoRoot>`
(the bin defaults to the `refactor` profile: all seven offline core capabilities plus `edit`).

## The write gates

Writing source needs the first two gates for either tool; `apply_edit_plan` adds the third:

1. This package is installed and the `refactor` profile (or a custom list naming `edit`) is selected.
2. The server environment has `WEAVATRIX_ALLOW_SOURCE_EDITS=1`.
3. For `apply_edit_plan` (mode="apply") only: a valid, unexpired `confirm_token` bound to the exact
   file hashes of the plan (5-minute TTL, issued by apply_edit_plan's own preview step, stored
   outside the repository). `rollback_last_apply` takes no token.

A missing gate is a normal state, not an error to work around: fall back to applying the plan's
edits with your own editor, then run `verified_change phase=verify` as usual.

## Tools

- **`apply_edit_plan plan=<envelope> [mode] [confirm_token]`** — two modes over the same plan.
  `mode="preview"` (default) re-verifies every planned file's sha256 and the exact `before` text
  and, on a clean match, issues a single-use `confirm_token`. `mode="apply" confirm_token=<token>`
  consumes it under the core file lock, writes a rollback bundle, applies edits bottom-up, and
  reports `APPLIED` / `STALE` (hash drift — nothing written) / `ROLLED_BACK` (mid-apply failure —
  originals restored). It never applies a subset silently.
- **`rollback_last_apply`** — restores the pre-apply state from the most recent rollback bundle.

## The refactoring loop

1. **Plan (read-only)**: call a weavatrix-refactor plan producer — `rename_symbol`,
   `rename_related_symbols`, `change_signature`, `edit_symbol`, `bulk_replace`, `organize_imports`
   (each emits a `weavatrix.edit-plan.v1` envelope), or `move_file` / `move_symbol` /
   `delete_readiness` (a review plan / dry-run / verdict you apply yourself) — or take a
   `plan_refactor` plan from `weavatrix-online`. An envelope carries per-edit provenance,
   `uncertainReferences`, and `notModified` reasons.
2. **Review before applying**: read `completeness`, `uncertainReferences`, `notModified`, and
   warnings such as `PUBLIC_API_SYMBOL` / `DYNAMIC_CODE_PRESENT`. A `PARTIAL` plan is applyable
   but finishes nothing by itself — the uncertain sites remain your responsibility.
3. **Preview → apply**: `apply_edit_plan plan=<envelope>` (mode="preview", the default) re-checks
   the working tree and issues a single-use `confirm_token`; then `apply_edit_plan plan=<envelope>
   mode="apply" confirm_token=<token>` writes. Tokens expire in 5 minutes and a stale tree fails
   closed as `STALE` — re-preview, do not retry the token.
4. **Prove**: `verified_change task=<task> phase=verify base_ref=<merge-base>` runs automatically
   after apply when available; read its PASS/BLOCKED/UNKNOWN verdict and the graph/architecture/
   duplicate ratchets before considering the refactor done.
5. **Finish the honest remainder**: edit every `uncertainReferences` site yourself (string keys,
   dynamic access, non-LSP languages), then re-run `verified_change`.

## Ground rules

- **This package never decides what to edit.** Plans come from its own read-only producers that
  prove against the core, with evidence; `renamed: 18, uncertainReferences: 3` is a correct
  outcome, a silent full success claim is not.
- **Fail closed, always**: hash drift, `before`-text mismatch, expired token, or any mid-apply
  error ends in `STALE` or `ROLLED_BACK`, never a partially edited tree without a report.
- **Only proven-provenance edits are applied** — `EXACT_LSP`, `RESOLVED`, `EXTRACTED`, or the
  byte-exact `LEXICAL_EXACT`. `INFERRED` / `CONFLICT` sites appear as review evidence, not edits.
- **The repository owner's tests remain the final proof.** `verified_change` ratchets are
  structural evidence; they are not a substitute for running the repo's own test suite.

## Troubleshooting

- `STALE` → the working tree changed after preview; re-run the weavatrix-refactor plan producer for a fresh plan.
- `TOKEN_EXPIRED` / `TOKEN_UNKNOWN` → previews are single-use and short-lived by design; re-preview.
- `WRITE_GATE_CLOSED` → set `WEAVATRIX_ALLOW_SOURCE_EDITS=1` on the server (a deliberate,
  user-visible choice) or apply the plan manually with your editor.
- `ROLLED_BACK` → originals were restored; inspect the reported failing file before retrying.
- `ROLLBACK_INCOMPLETE` → some files could not be restored (locked/read-only); the bundle is
  kept. Unblock the listed files and run `rollback_last_apply` again — retries converge.
- `REPO_BUSY` → another apply/rollback holds the per-repository lock; retry shortly.
- `PATH_ESCAPES_REPO` / `EDIT_PRODUCES_INVALID_TEXT` / `FILE_TOO_LARGE` → the plan or tree
  violates a write-safety invariant; nothing was written — fix the plan, do not force it.
