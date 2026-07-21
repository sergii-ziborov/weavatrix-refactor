---
name: weavatrix-refactor
description: "Apply hash-verified refactoring edit plans computed by the read-only weavatrix core: preview in core, review the honest uncertainty labels, confirm, apply with automatic rollback, then prove the change with verified_change. The only Weavatrix component that writes code."
---

# weavatrix-refactor MCP

> **Status: pre-release. The tools described here are the committed contract but are not
> implemented yet. Do not advertise them as available until this banner is removed.**

The write-side companion to the MIT `weavatrix` core. The core is safe by design: its published
artifact contains no source-writing paths, so it can *compute and prove* a refactoring but never
*apply* one. This package applies **only** plans the core computed, proved, and hashed — it never
invents edits of its own.

## Step 0 — if the tools are missing

Tools are named `mcp__weavatrix__…` (one merged catalog: core tools plus this extension). If
`apply_edit_plan` is absent, either this package is not installed, its `refactor` profile is not
selected, or the write gate is closed. Register with:
`claude mcp add -s user weavatrix -- npx -y weavatrix-refactor <repoRoot>`
(the bin defaults to the `refactor` profile: all seven offline core capabilities plus `edit`).

## The three write gates

Nothing is ever written unless all three hold:

1. This package is installed and the `refactor` profile (or a custom list naming `edit`) is selected.
2. The server environment has `WEAVATRIX_ALLOW_SOURCE_EDITS=1`.
3. The call carries a valid, unexpired `confirm_token` bound to the exact file hashes of the plan
   (5-minute TTL, issued by a core preview tool, stored outside the repository).

A missing gate is a normal state, not an error to work around: fall back to applying the plan's
edits with your own editor, then run `verified_change phase=verify` as usual.

## Tools

- **`apply_edit_plan confirm_token=<token>`** — re-verifies every planned file's sha256 and the
  exact `before` text at every range under the core file lock, writes a rollback bundle, applies
  edits bottom-up, refreshes the graph, and reports `applied` / `STALE` (hash drift — nothing
  written) / `ROLLED_BACK` (mid-apply failure — originals restored). It never applies a subset
  silently.
- **`rollback_last_apply`** — restores the pre-apply state from the most recent rollback bundle.

## The refactoring loop

1. **Plan (core, read-only)**: call a core preview tool — `rename_symbol`, `move_symbol` /
   `move_file`, `delete_readiness`, `change_signature` — or take a `plan_refactor` plan from
   `weavatrix-online`. The result is a `weavatrix.edit-plan.v1` envelope with per-edit provenance,
   `uncertainReferences`, `notModified` reasons, and a `confirm_token`.
2. **Review before confirming**: read `completeness`, `uncertainReferences`, `notModified`, and
   warnings such as `PUBLIC_API_SYMBOL` / `DYNAMIC_CODE_PRESENT`. A `PARTIAL` plan is applyable
   but finishes nothing by itself — the uncertain sites remain your responsibility.
3. **Apply**: `apply_edit_plan confirm_token=<exact token>`. Tokens are single-use and expire in
   5 minutes; a stale working tree fails closed as `STALE` — re-run the preview, do not retry the
   token.
4. **Prove**: `verified_change task=<task> phase=verify base_ref=<merge-base>` runs automatically
   after apply when available; read its PASS/BLOCKED/UNKNOWN verdict and the graph/architecture/
   duplicate ratchets before considering the refactor done.
5. **Finish the honest remainder**: edit every `uncertainReferences` site yourself (string keys,
   dynamic access, non-LSP languages), then re-run `verified_change`.

## Ground rules

- **This package never decides what to edit.** Plans come from the read-only core with evidence;
  `renamed: 18, uncertainReferences: 3` is a correct outcome, a silent full success claim is not.
- **Fail closed, always**: hash drift, `before`-text mismatch, expired token, or any mid-apply
  error ends in `STALE` or `ROLLED_BACK`, never a partially edited tree without a report.
- **Only `EXACT_LSP` / `RESOLVED` provenance is ever applied.** `INFERRED` sites appear as review
  evidence, not edits.
- **The repository owner's tests remain the final proof.** `verified_change` ratchets are
  structural evidence; they are not a substitute for running the repo's own test suite.

## Troubleshooting

- `STALE` → the working tree changed after preview; re-run the core preview tool for a fresh plan.
- `TOKEN_EXPIRED` / `TOKEN_UNKNOWN` → previews are single-use and short-lived by design; re-preview.
- `WRITE_GATE_CLOSED` → set `WEAVATRIX_ALLOW_SOURCE_EDITS=1` on the server (a deliberate,
  user-visible choice) or apply the plan manually with your editor.
- `ROLLED_BACK` → originals were restored; inspect the reported failing file before retrying.
