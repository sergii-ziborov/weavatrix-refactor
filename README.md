# weavatrix-refactor

Evidence-backed, transactional refactoring for coding agents.

`weavatrix-refactor` is the write-capable member of the Weavatrix family. It
combines the complete read-only `weavatrix` code-intelligence MCP with 11
refactoring tools that can prove a change, preview it against the current
working tree, apply it atomically, refresh the graph, and roll it back.

It is substantially more than a rename wrapper:

- semantic JS/TS rename through the bundled language server;
- SQL table and field rename with schema-aware evidence;
- strict graph-plus-lexical rename for Python, Rust, Go, Java, C#, and Solidity;
- several related JS/TS renames merged into one atomic transaction;
- signature, symbol-body, import, bulk-replace, move, and delete-safety workflows;
- byte-exact file hashes, `before` text, provenance, uncertainty, and graph revision in every applyable plan;
- stale-tree detection, repository locking, rollback bundles, and automatic rollback after a mid-write failure;
- architecture and cycle projection before structural moves;
- post-change blast-radius and verification tools inherited from the core.

## Why this is a separate package

The MIT `weavatrix` core is physically read-only: its published artifact has no
repository source-write path. This Apache-2.0 package is the explicit write
boundary. Installing it and selecting its `refactor` profile makes the `edit`
capability visible; without this package, the server cannot modify source.

The split is a safety property, not packaging cosmetics:

```text
weavatrix core          weavatrix-refactor                 repository
read-only evidence  ->  plan + preview + confirmation  ->  atomic write
graph / LSP / audit     hashes / provenance / rollback     refreshed graph
```

## What makes the refactor workflow different

An ordinary editor rename answers: "Which text edits should I make now?"
Weavatrix Refactor also answers:

| Question | Evidence returned |
| --- | --- |
| Is this the exact symbol? | Stable graph symbol id plus parser/LSP selection range |
| Which references are proven? | Per-edit provenance: `EXACT_LSP`, `RESOLVED`, `EXTRACTED`, or `LEXICAL_EXACT` |
| What was not proven? | Explicit `uncertainReferences`, `notModified`, warnings, and `PARTIAL` completeness |
| Did the tree change after preview? | File sha256 plus exact `before` text rechecked under the write lock |
| Can several renames partially succeed? | No. Related renames are conflict-checked and applied as one transaction |
| What happens after a disk/write failure? | Already-written files are restored; a durable rollback bundle remains |
| Will a move worsen architecture? | Projected runtime cycles, boundary violations, improvements, and blast radius |
| Did the refactor preserve behavior-shaped structure? | Refreshed graph plus `verified_change` caller/import/reference conservation |

The system fails closed when proof is insufficient. It never upgrades an
`INFERRED` edge into an applyable edit and never hides an ambiguous reference.

## The complete rename workflow

`rename_symbol` and `rename_related_symbols` are complete operations, not
`PLANNED`-only helpers. Each method owns both phases.

### 1. Preview

Call the rename method normally:

```json
{
  "symbol": "src/users.ts#getUser@12",
  "new_name": "getCustomer"
}
```

The method computes the rename, validates every plan file against the working
tree, and returns `PREVIEW_OK` with a short-lived `confirmToken`. Preview never
writes source and does not require the environment write gate.

### 2. Apply through the same method

Repeat the same operation inputs and add the confirmation:

```json
{
  "symbol": "src/users.ts#getUser@12",
  "new_name": "getCustomer",
  "mode": "apply",
  "confirm_token": "<token from preview>"
}
```

The tool recomputes the deterministic plan, verifies that the token belongs to
that plan and repository, takes the repository lock, rechecks hashes and
`before` text, writes a rollback bundle, and applies every edit bottom-up.

The same contract applies to a coordinated set:

```json
{
  "renames": [
    {"symbol": "src/api.ts#getUser@8", "new_name": "getCustomer"},
    {"symbol": "src/api.ts#getOrder@20", "new_name": "getPurchase"}
  ]
}
```

`rename_related_symbols` detects overlapping edits, chains, swaps, shadowing
risk, and per-sub-rename failure before it issues a token. Apply is one atomic
multi-file operation.

## Refactoring tools

### Complete write workflows

| Tool | What it actually does |
| --- | --- |
| `rename_symbol` | Cross-language preview/confirm/apply rename. Dispatches to exact JS/TS LSP, SQL schema, or strict graph+lexical backends; returns honest backend completeness and every uncovered reference. |
| `rename_related_symbols` | Coordinates up to 50 JS/TS symbol renames in one shared language-server session and one atomic edit plan. Detects conflicts, chains, swaps, snapshot drift, and any failed sub-rename before writing. |
| `apply_edit_plan` | Generic two-phase executor for `weavatrix.edit-plan.v1` envelopes from the other tools or `weavatrix-online`. Preview issues a plan-bound token; apply writes atomically with rollback. |
| `rollback_last_apply` | Restores the latest pre-apply bundle. Refuses if post-apply files drifted; retries converge after an incomplete restore. |

### Proven plan producers

| Tool | What it actually does |
| --- | --- |
| `change_signature` | Adds or removes a JS/TS function or method parameter. Performs byte-exact declaration and call-argument surgery; spread calls and value-requiring additions remain explicit uncertainty. |
| `edit_symbol` | Uses the indexed parser range for `replace_symbol_body`, `insert_before_symbol`, or `insert_after_symbol`. JS/TS output is parse-gated; line endings and UTF-16 coordinates are preserved. |
| `bulk_replace` | Two-stage, occurrence-selective replacement over indexed files. First returns stable occurrence ids; the second call accepts chosen ids or an exact expected count and emits a hash-bound plan. Literal mode is the default; regex replacements use real capture expansion. |
| `organize_imports` | Removes only provably unused named JS/TS imports. Default and namespace imports stay uncertain; side-effect imports are untouched; sorting is deliberately left to the formatter. |

These plans are applied with `apply_edit_plan`, using the same preview, token,
atomic-write, and rollback protocol as rename.

### Structural review and safety tools

| Tool | What it actually does |
| --- | --- |
| `move_file` | Builds a JS/TS relocate review: rewrites importer specifiers and the moved file's own relative imports, then projects architecture effects. File renaming itself remains an explicit editor/agent action, so this is intentionally not an apply envelope. |
| `move_symbol` | Projects a declaration move without inventing byte edits. Reports introduced/removed runtime cycles, target-file dependencies, architecture violations or improvements, and blast radius. |
| `delete_readiness` | Returns `safe: true`, `false`, or `UNPROVEN` with known references, dynamic/reflection risks, confidence, and the declaration span. Exported symbols are capped at `UNPROVEN`; deletion is never automated. |

## Language and proof matrix

| Surface | Backend | Applyable provenance | Completeness contract |
| --- | --- | --- | --- |
| JavaScript / TypeScript rename | Bundled TypeScript language server | `EXACT_LSP` | `COMPLETE` only when the language-server result and repository boundary are complete |
| SQL table rename | Schema-aware SQL scanner across SQL and host files | `EXTRACTED` / `LEXICAL_EXACT` | Reports every skipped or ambiguous reference |
| SQL field rename | Definition-safe SQL backend | Proven definition edits only | Usages remain `UNPROVEN` rather than guessed |
| Python / Rust / Go / Java / C# / Solidity rename | Indexed graph references plus exact lexical location on the recorded line | `EXTRACTED` / `LEXICAL_EXACT` | Always `PARTIAL`; ambiguous lines are never edited |
| JS/TS signature and imports | Parser plus graph call/reference evidence | `EXTRACTED` / `RESOLVED` | Explicitly partial where graph reach cannot prove absence |
| Symbol-anchored edit | Indexed parser ranges for every indexed language | `EXTRACTED` | JS/TS parse gate; other languages retain the parser-range evidence boundary |

## Edit-plan proof envelope

Every applyable plan uses `weavatrix.edit-plan.v1`. Its load-bearing fields are:

- operation and graph revision;
- repository-relative target paths only;
- sha256 of every target file;
- exact 1-based line and UTF-16 character ranges;
- exact `before` and `after` text;
- per-edit provenance;
- `uncertainReferences`, `notModified`, warnings, and completeness.

The applier additionally protects against:

- absolute paths, traversal, `.git` casing/trailing-dot tricks, NTFS streams, and escaping symlinks/junctions;
- non-UTF-8 or oversized files;
- overlapping edits, stale ranges, lone surrogates, and edits that split surrogate pairs;
- two writers interleaving in the same repository;
- token reuse, expiry, repository mismatch, or plan mismatch;
- partial writes and incomplete rollback.

`createdAt` is provenance metadata and is the only field excluded from the
confirmation fingerprint. This allows a rename method to recompute the same
plan on its apply call; every executable field remains token-bound.

## Result states agents can act on

| State | Meaning |
| --- | --- |
| `PREVIEW_OK` | Every hash and `before` text matches; a single-use token was issued. |
| `PREVIEW_BLOCKED` | The generated plan does not match the current tree; nothing can be applied. |
| `WRITE_GATE_CLOSED` | The server was not deliberately started with source edits enabled. |
| `APPLIED` | Every planned edit was written and the rollback bundle is available. |
| `STALE` | The working tree changed between preview and the locked apply check; nothing was written. |
| `TOKEN_UNKNOWN` / `TOKEN_EXPIRED` / `TOKEN_*_MISMATCH` | Confirmation is absent, consumed, expired, or belongs to another plan/repository. |
| `REPO_BUSY` | Another apply or rollback currently owns the repository lock. |
| `ROLLED_BACK` | A failed apply or explicit rollback restored the original files. |
| `ROLLBACK_INCOMPLETE` | Restoration was blocked for named files; the durable bundle remains retryable. |
| `INVALID_PLAN` | Schema, path, range, encoding, overlap, or provenance validation failed before writing. |

Planner-specific states such as `NOT_FOUND`, `NO_CHANGE`, `CONFLICT`,
`BLOCKED`, `UNPROVEN`, and `NOT_SUPPORTED` remain visible instead of being
collapsed into a generic failure.

## The three write gates

Repository source changes require all three:

1. `weavatrix-refactor` is installed and the `refactor` profile selects `edit`;
2. the server starts with `WEAVATRIX_ALLOW_SOURCE_EDITS=1`;
3. the apply call presents a valid, unexpired, single-use token bound to the
   exact plan and repository.

Preview and every read-only analysis remain available while the environment
gate is closed.

## End-to-end change proof

The package includes all 34 read-only core tools in the same MCP server. A
strong refactor session can therefore stay in one evidence chain:

1. `inspect_symbol`, `context_bundle`, or `get_dependents` identifies the exact target;
2. `rename_symbol`, `change_signature`, `move_symbol`, or another refactor tool previews the change;
3. the write workflow applies atomically;
4. the next graph call auto-refreshes changed files and reverse importers;
5. `verified_change` compares callers, imports, and references against the merge base;
6. `change_impact`, `verify_architecture`, `coverage_map`, `run_audit`, and `find_duplicates` inspect the consequences.

Useful inherited surfaces include:

- architecture maps and navigation: `module_map`, `query_graph`, `shortest_path`, `context_bundle`;
- impact and proof: `change_impact`, `get_dependents`, `prepare_change`, `verified_change`;
- health: `run_audit`, `find_dead_code`, `find_duplicates`, `coverage_map`, `hot_path_review`;
- contracts: `list_endpoints`, `trace_endpoint`, `trace_api_contract`;
- target architecture: `get_architecture_contract`, `verify_architecture`, `explain_architecture_violation`;
- repository control: `open_repo`, `rebuild_graph`, `graph_diff`, `list_known_repos`.

See the [weavatrix README](https://github.com/sergii-ziborov/weavatrix) for the
complete core catalog.

## Install

```bash
npx -y weavatrix-refactor <repoRoot>
```

Set `WEAVATRIX_ALLOW_SOURCE_EDITS=1` only for sessions in which apply and
rollback should be enabled.

## Scope and honest limits

- Related multi-symbol rename is currently JS/TS-only.
- `move_file` cannot rename the file through `apply_edit_plan`; it is a review
  plan because file relocation has different filesystem semantics.
- `move_symbol` is a topology/architecture dry-run, not byte-edit synthesis.
- Graph+lexical language backends cannot prove reference completeness and stay
  `PARTIAL` even when every known reference was located.
- `delete_readiness` never auto-deletes, and public/exported APIs cannot receive
  an automatic clean verdict.
- Tests, typechecking, runtime checks, and human review remain the release
  authority. Weavatrix supplies bounded evidence; it does not fabricate proof.

## Package boundary

| Package | License | Responsibility |
| --- | --- | --- |
| `weavatrix` | MIT | Read-only graph, analysis, evidence, architecture, and verification |
| `weavatrix-refactor` | Apache-2.0 | Proven refactor plans, transactional writes, and rollback |
| `weavatrix-online` | Source-available/commercial terms | Explicit network connector and remote plan/evidence workflows |

The refactor package extends core only through `weavatrix/extension-api` and
`weavatrix/analysis-kit`; it does not copy or relicense the core.

## License

Apache-2.0. The explicit patent grant and warranty/liability terms are a
deliberate fit for a package whose purpose is writing code.
