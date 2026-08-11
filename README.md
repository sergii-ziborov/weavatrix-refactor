# Weavatrix Refactor

**Refactor across files without letting the agent guess.**

Weavatrix Refactor is a native MCP server for coding agents. It finds a symbol through the
repository graph, previews byte-exact edits, reports every same-named occurrence it could not
prove, and writes only after an explicit, hash-bound confirmation.

The useful difference is not “AI can rename a word.” It is that the agent gets evidence before
the write and a recoverable transaction after it.

## Install

Run the native binary through npm:

```bash
npx -y weavatrix-refactor mcp /absolute/path/to/repository
```

Or install it with Cargo:

```bash
cargo install weavatrix-refactor --locked
weavatrix-refactor mcp /absolute/path/to/repository
```

An MCP client can start it directly:

```json
{
  "mcpServers": {
    "weavatrix-refactor": {
      "command": "weavatrix-refactor",
      "args": ["mcp", "/absolute/path/to/repository"],
      "env": {"WEAVATRIX_ALLOW_SOURCE_EDITS": "1"}
    }
  }
}
```

Leave `WEAVATRIX_ALLOW_SOURCE_EDITS` unset for preview-only sessions. Preview is a read; only a
confirmed apply or rollback requires the gate.

## A safe cross-file rename in three calls

Suppose two files declare `resolveTarget`. A bare name is ambiguous, so the server refuses to
pick one and returns exact ids:

```json
// rename_symbol
{"symbol":"resolveTarget","new_name":"locateTarget","output_format":"json"}

{
  "status": "NOT_FOUND",
  "reason": "the name matches more than one symbol; pass one of the candidate ids",
  "candidates": [
    "symbol:src/core.ts#function:resolveTarget@2:1",
    "symbol:src/shadow.ts#function:resolveTarget@3:1"
  ]
}
```

Retry with the intended id. The result is still read-only: it contains the edit plan, content
hashes, the proven edit count, and the references the backend refused to guess at.

```json
// rename_symbol
{
  "symbol": "symbol:src/core.ts#function:resolveTarget@2:1",
  "new_name": "locateTarget",
  "output_format": "json"
}

{
  "status": "PLANNED",
  "completeness": "PARTIAL",
  "renamedEdits": 7,
  "uncertainReferences": ["... three named locations ..."],
  "confirmToken": "single-use-token",
  "plan": {"schemaVersion":"weavatrix.edit-plan.v1","files":["..."]}
}
```

After reviewing the plan, repeat the same operation with the same inputs and its token:

```json
// rename_symbol
{
  "symbol": "symbol:src/core.ts#function:resolveTarget@2:1",
  "new_name": "locateTarget",
  "mode": "apply",
  "confirm_token": "single-use-token",
  "output_format": "json"
}

{"status":"APPLIED"}
```

This exact flow is exercised against the real stdio MCP server. The repository fixture requires
seven edits across three files, preserves four traps (a longer identifier, string, comment, and
unrelated shadow), and must still compile; it scores **12/12**.

## What is automatic today

The eleven tools do not all claim the same level of automation:

| Level | Tools | What the agent receives |
| --- | --- | --- |
| Complete preview/apply workflow | `rename_symbol`, `rename_related_symbols` | A generated plan and token, then a confirmed write by repeating the same operation |
| Plan-producing | `change_signature`, `edit_symbol`, `bulk_replace`, `organize_imports`, `move_file` | Byte-exact edits or a review plan; use `apply_edit_plan` where an edit-plan envelope is returned |
| Advisory | `move_symbol`, `delete_readiness` | Blast radius, cycle/architecture risks, or a deletion verdict; no automatic source write |
| Safety infrastructure | `apply_edit_plan`, `rollback_last_apply` | Verification/application of an edit-plan envelope and drift-safe restoration |

The same process also exposes the read-only Weavatrix repository tools, so discovery, impact
analysis, planning, and application share one graph revision and one session.

## Safety model and exact limits

- Ambiguous names fail with candidate ids instead of selecting the first match.
- `PARTIAL` means the graph proved the edits in the plan but did **not** prove that no other
  semantic references exist. `uncertainReferences` names the places requiring review.
- Every file in a plan carries a content hash. A changed working tree makes the preview stale
  instead of applying the old coordinates.
- Apply requires `WEAVATRIX_ALLOW_SOURCE_EDITS=1` plus a short-lived, single-use token bound to
  that repository and exact recomputed plan.
- `rollback_last_apply` refuses to overwrite files that drifted after the transaction.
- Multi-file writes are journaled and crash-recoverable. They are not observationally atomic to
  unrelated processes: another process may briefly observe an intermediate filesystem state.

Only edits with proven provenance are applied. A lexical or graph backend is deliberately more
conservative than a language server and must not be read as a claim of full compiler semantics.

## Measured benchmark, with unlike layers kept separate

The checked-in August 2026 report uses one adversarial TypeScript rename fixture. Protocol rows
measure real MCP startup/calls and all protocol-visible text with `o200k_base`. The naked Codex
row measures an entire model-driven agent run and its reported model usage. Those are different
layers, so the report does not combine them into a synthetic speedup.

| Contender | Correctness | Measured time | Measured context |
| --- | ---: | ---: | ---: |
| Weavatrix Refactor 1.0.4 protocol flow | **12/12 x3** | 1,236 ms median total | 12,265 protocol-visible tokens |
| Serena suggested protocol flow | **7/12 x3** | 11,215 ms median total | 5,864 protocol-visible tokens |
| Serena manually warmed protocol flow | **12/12 x1** | 35,805 ms total | 6,478 protocol-visible tokens |
| Naked Codex agent | **12/12 x3** | 38,475 ms median end-to-end | 71,363 median input tokens |

On this small fixture Serena's failed flow and a naked mechanical script can be cheaper. The
product's demonstrated value is failure visibility, stale-plan refusal, and recovery—not a claim
that every small repository costs fewer tokens. The next benchmark revision expands the same
grader discipline to TypeScript, Rust, and Python and measures model-driven MCP runs separately.

See the [full methodology, raw-result links, and limitations](docs/benchmarks/refactor-vs-competitors-2026-08.md).

## Contract and architecture

The tool names, schemas, and result states are frozen in
[`contract/refactor-tools.v1.json`](contract/refactor-tools.v1.json). All refactor operations are
native Rust; the host merges them with the read-only
[`weavatrix-rust`](https://github.com/sergii-ziborov/weavatrix-rust) engine. The migration record
is in [docs/rust-migration.md](docs/rust-migration.md).

Versions 0.1.x used the JavaScript engine. That line continues as
[`weavatrix-refactor-js`](https://github.com/sergii-ziborov/weavatrix-refactor-js) and keeps a
separate state directory, token store, and rollback journal.

## License

MIT.
