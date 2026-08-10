# weavatrix-refactor

Transactional refactoring MCP for coding agents: 11 evidence-backed plan/apply
tools, hash-bound previews, atomic writes, and rollback — plus the 43 read-only
operations of the Weavatrix engine, in one process.

```bash
npx -y weavatrix-refactor mcp /absolute/path/to/repository
```

This package ships the native Rust binary. Nothing is compiled at install time,
there are no lifecycle scripts, and no runtime dependencies.

Producing a plan is a read. Applying one requires all three gates: the host
exposes the edit capability, `WEAVATRIX_ALLOW_SOURCE_EDITS=1` is set, and the
call presents a single-use token bound to that exact plan and repository.

> **1.0 is the engine change.** Versions 0.1.x were a JavaScript package. That
> implementation continues as
> [`weavatrix-refactor-js`](https://www.npmjs.com/package/weavatrix-refactor-js),
> which picks up the version line at 0.1.6 where `weavatrix-refactor@0.1.5` left
> off. The two keep separate state directories, so they never share a lock, a
> token store, or a rollback journal.

Full documentation:
[github.com/sergii-ziborov/weavatrix-refactor](https://github.com/sergii-ziborov/weavatrix-refactor)

MIT.
