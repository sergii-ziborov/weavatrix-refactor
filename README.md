# Weavatrix Refactor

**Native MCP server for repository intelligence with proven, transactional refactoring.**

One process answers both halves: every read-only operation of the
[`weavatrix-rust`](https://github.com/sergii-ziborov/weavatrix-rust) engine and the eleven
refactor tools from
[`weavatrix-rust-refactor`](https://github.com/sergii-ziborov/weavatrix-rust-refactor). A refactor
session therefore stays in one evidence chain, on one graph revision, with no second process to
keep in step.

```text
weavatrix-rust            reusable read-only evidence engine
        |
        +-- weavatrix             read-only MCP host
        |
        +-- weavatrix-rust-refactor   refactor operations
                    |
                    +-- weavatrix-refactor   this MCP host
```

> **1.0 is the engine change.** Versions 0.1.x were a JavaScript package hosting the
> `weavatrix-js` engine. That implementation continues as
> [`weavatrix-refactor-js`](https://github.com/sergii-ziborov/weavatrix-refactor-js) — pin
> `weavatrix-refactor@0.1.6` or install `weavatrix-refactor-js` to stay on it. The two keep
> separate state directories on purpose, so they never share a lock, a token store, or a
> rollback journal.

## Run it

```bash
weavatrix-refactor mcp /absolute/path/to/repository
```

For an MCP client:

```json
{
  "mcpServers": {
    "weavatrix-refactor": {
      "command": "weavatrix-refactor",
      "args": ["mcp", "/absolute/path/to/repository"]
    }
  }
}
```

Every analysis and preview tool works as configured above. Source writes fail closed. Add
`"env": {"WEAVATRIX_ALLOW_SOURCE_EDITS": "1"}` only for a session in which apply and rollback are
deliberately authorized.

## The three write gates

Repository source changes require all three:

1. this package is installed, so refactor tools exist in the catalog at all;
2. the server was started with `WEAVATRIX_ALLOW_SOURCE_EDITS=1`, read once at startup — a gate
   that a tool argument could flip would not be a gate;
3. the apply call presents a valid, unexpired, single-use token bound to that exact plan and
   repository.

The command line is not a way around this: `weavatrix-refactor tool <writing-tool>` refuses with
the same `WRITE_GATE_CLOSED` status.

## The contract is frozen

The eleven tool names, their schemas and all 47 result states were recorded from the shipping
JavaScript implementation into
[`contract/refactor-tools.v1.json`](contract/refactor-tools.v1.json), which is compiled into
`weavatrix-rust-refactor` as the only source of the tool catalog. A client written against 0.1.x
sees the same names, the same arguments and the same statuses here.

## Migration status

The catalog is complete and live. Engines land one at a time, and an operation that has not been
ported answers `NOT_SUPPORTED` — itself a contract status — naming `weavatrix-refactor-js` as the
implementation to use meanwhile. Nothing is hidden behind a flag, so a client can always tell
which half is native. See [docs/rust-migration.md](docs/rust-migration.md).

| Area | State |
| --- | --- |
| MCP host, merged catalog, write gate | done |
| Safety kernel (containment, UTF-16 ranges, fingerprints, tokens, locking, atomic write, rollback) | provided by `weavatrix-edit` / `weavatrix-worktree` |
| Graph-native planners | pending |
| JavaScript/TypeScript signature, imports and exact rename | pending, last by design |

## License

MIT.
