# Edit plan schema — DRAFT v1

Status: draft for review. This schema is the frozen contract between the
read-only `weavatrix` core (which computes and proves plans) and
`weavatrix-refactor` (which applies them). The core-side ADR reversing the
"symbol rename is editor behavior" stance must be accepted before this
freezes. Once frozen, changes require a `schemaVersion` bump and a
compatible-pair release.

## Envelope

```json
{
  "schemaVersion": "weavatrix.edit-plan.v1",
  "operation": "rename_symbol",
  "createdAt": "2026-07-21T12:00:00Z",
  "repoRoot": "C:/repo",
  "graphRevision": "<git rev the plan was computed against>",
  "confirmToken": "<one-time token, 5-minute TTL, bound to repoRoot + graphRevision + file hashes>",
  "completeness": "COMPLETE | PARTIAL",
  "files": [
    {
      "path": "src/user.ts",
      "sha256": "<hash of the file content the plan was computed from>",
      "edits": [
        {
          "startLine": 10, "startChar": 8, "endLine": 10, "endChar": 15,
          "before": "getUser",
          "after": "getCustomer",
          "provenance": "EXACT_LSP | RESOLVED | EXTRACTED"
        }
      ]
    }
  ],
  "uncertainReferences": [
    {"path": "factory.ts", "line": 42, "kind": "DYNAMIC_PROPERTY_ACCESS", "excerpt": "obj['getUser']"}
  ],
  "notModified": [
    {"path": "factory.ts", "reason": "dynamic property access — not proven, not edited"}
  ],
  "warnings": ["PUBLIC_API_SYMBOL", "DYNAMIC_CODE_PRESENT"],
  "followUp": "run verified_change phase=verify after apply"
}
```

## Invariants

1. **Positions are UTF-16 code-unit offsets** (LSP convention), 0-based
   character, 1-based line, matching the core symbol-node ranges.
2. **`before` is mandatory** on every edit: the applier re-verifies not just
   the file hash but the exact text at the range before splicing. Any
   mismatch fails the whole plan closed — no partial applies.
3. **Only `EXACT_LSP` / `RESOLVED` provenance edits may appear in `files`.**
   Anything uncertain goes to `uncertainReferences` / `notModified`. A plan
   never edits what it cannot prove.
4. Edits within a file are applied **bottom-up** (descending offset) so
   earlier splices never invalidate later ranges.
5. The applier writes a **rollback bundle** (original file contents) before
   the first splice; any failure restores it and reports `ROLLED_BACK`.
6. The plan file and token live in the out-of-repo graph directory (the
   architecture-bootstrap pattern), never inside the repository.
7. `completeness: PARTIAL` plans are applyable, but the response must carry
   the untouched `uncertainReferences` forward so the calling agent finishes
   the job — an honest `"renamed": 18, "uncertainReferences": 3` result,
   never a false complete.

## Apply gates (all three required)

1. `weavatrix-refactor` installed and its `refactor` profile selected.
2. `WEAVATRIX_ALLOW_SOURCE_EDITS=1` in the environment.
3. Valid unexpired `confirmToken` whose bound hashes still match the working
   tree at apply time (re-checked under the core file lock).

## Producers and consumers

| Producer (read-only) | Package |
| --- | --- |
| `rename_symbol` preview | weavatrix (core) |
| `move_symbol` / `move_file` preview | weavatrix (core) |
| `delete_readiness` preview | weavatrix (core) |
| `change_signature` preview | weavatrix (core) |
| `plan_refactor` | weavatrix-online (paid) |

| Consumer (writes) | Package |
| --- | --- |
| `apply_edit_plan` | weavatrix-refactor |
| `rollback_last_apply` | weavatrix-refactor |
