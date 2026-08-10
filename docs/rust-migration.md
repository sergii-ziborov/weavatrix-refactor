# Native Rust migration contract

Status: **done**. This was the implementation sequence for replacing the 0.1.x
JavaScript host without weakening the refactoring proof boundary; it is kept as
the record of what was required and what the result actually is. The outcome is
at the bottom.

## Current mismatch

`weavatrix` 1.x is a native MCP adapter over `weavatrix-rust` 2.x, while
`weavatrix-refactor` 0.1.x still composes `weavatrix-js` 0.3.x through its
extension API. The packages therefore do not share one graph implementation,
revision model, or operation runtime.

The migration must not put editing into either read-only repository:

```text
weavatrix-rust          reusable read-only evidence engine
        |
        +-- weavatrix   read-only MCP, watcher, native npm distribution
        |
        +-- weavatrix-refactor
                        Rust refactor MCP, edit plans, writes, rollback
```

The Rust Refactor host should depend directly on `weavatrix-rust`; it should
not spawn the `weavatrix` executable or proxy a second MCP process.

## Required migration order

1. Freeze the existing 11 tool schemas, result states, edit-plan v1 fixtures,
   and the current behavior suite as cross-language golden tests.
2. Port the safety kernel first: path containment, UTF-16 range conversion,
   exact `before` checks, plan fingerprints, expiring single-use tokens,
   repository locking, atomic replacement, durable rollback, and retryable
   incomplete recovery.
3. Build the Rust MCP host with `mcport` and compose the 39 read-only
   operations directly from `weavatrix-rust` with the 11 refactor tools.
4. Port graph-native planners: graph/lexical rename, SQL rename, bulk replace,
   symbol edit, move review, delete readiness, and conservation checks.
5. Port JavaScript/TypeScript signature, imports, and exact rename last. Keep
   the existing TypeScript language-server adapter as an explicit compatibility
   feature until a native resolver passes the same rename fixtures. Do not
   relabel graph/lexical evidence as `EXACT_LSP` or `COMPLETE`.
6. Replace the npm launcher only after the native package passes installed-MCP
   tests on every supported target. Remove `weavatrix-js` and `typescript`
   dependencies only when their covered behavior has a proven replacement.

## Release acceptance

- all 39 core and 11 refactor tools are exposed by one process;
- the read-only tools come from the same `weavatrix-rust` revision as
  standalone `weavatrix`;
- preview remains write-free and apply still requires
  `WEAVATRIX_ALLOW_SOURCE_EDITS=1` plus a plan-bound confirmation token;
- stale files, path escapes, NTFS alternate streams, symlink/junction escapes,
  partial writes, and rollback drift fail closed;
- current edit-plan and result-state JSON remains compatible;
- all existing behavioral fixtures have Rust equivalents or cross-runtime
  golden parity coverage;
- self-analysis and Refactor dogfood show no unresolved internal imports,
  architecture violations, or generated-package pollution;
- formatting, strict Clippy, all-feature and minimal tests, rustdoc, package
  contents, and installed MCP initialize/list/call gates pass.

This is an incremental replacement, not a second greenfield protocol. The
published JavaScript package remains the compatibility oracle until every
load-bearing behavior above is covered by the Rust implementation.

## Outcome

One process exposes 53 tools: 42 read-only from `weavatrix-rust` and the 11
refactor tools from `weavatrix-rust-refactor`. Every refactor operation is a
native engine and dispatch has no fallback arm, so a tool added to the contract
fails to compile rather than answering `NOT_SUPPORTED` at run time.

Step 5 was met without a language server. The rename, signature and import
engines read the graph and the tokenizer, which is why they cover Rust, Python,
Go, Java and C# as well as JavaScript and TypeScript — and why none of them
labels its evidence `EXACT_LSP` or `COMPLETE`. They prove the sites they edit,
not the absence of others, so every planner answers `PARTIAL` and hands back the
occurrences it refused to guess at. That is a weaker claim than a language
server makes and a true one, which was the constraint step 5 actually imposed.

Two limits are worth stating plainly, because they are the price of that choice:

- A call the graph did not record is a call no operation touches. For a rename
  that leaves an old name behind; for `change_signature` it leaves a call passing
  an argument the function no longer takes.
- `organize_imports` plans only for JavaScript and TypeScript. Elsewhere it
  reports candidates and answers `UNPROVEN`, because `use std::io::Write` is used
  by calling `write_all` and a Python import in `__init__.py` is often the public
  API — both pass an occurrence count and both break on removal.
