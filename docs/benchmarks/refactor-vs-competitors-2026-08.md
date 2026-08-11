# Rename benchmark: weavatrix-refactor vs Serena vs a naked Codex agent

Measured on 2026-08-10 and 2026-08-11 on one Windows 11 machine. All times are
milliseconds. All protocol text is counted with `o200k_base`; bytes are retained
only as transport diagnostics. The fixture, drivers, grader, raw captures, and
summary generator are versioned under [`benchmarks/rename-agent`](../../benchmarks/rename-agent/README.md).

## The task and ground truth

Rename the exported `resolveTarget` in `src/core.ts` to `locateTarget` across a
four-file TypeScript repository. The grader has 12 checks:

- seven required edits: declaration, recursion, template interpolation, two
  imports, a function-body call, and a module-top-level call;
- four traps that must remain unchanged: a longer identifier, string literal,
  comment, and unrelated module-local shadow;
- one build gate: `tsc --noEmit` passes.

## Two measurements, kept separate

The MCP rows are a deterministic **protocol-layer** benchmark: real server
startup and tool wall time, plus the exact tokens exposed to an agent by
`initialize`, `tools/list`, tool calls, and tool results. They exclude the
agent model's common system prompt and planning loop.

The naked row is a real **agent end-to-end** benchmark: Codex CLI with no MCP
servers performs the task, edits files, and runs the compiler. Its cumulative
usage includes repeated model invocations, built-in tool context, file reads,
tool output, planning, and the final answer. Therefore its token totals are not
placed in the MCP protocol table and no assumed tokens-per-second conversion is
added to server time.

### MCP protocol layer

| Contender | Correctness | Session fixed context | Task result context | Task-call output | Startup median | Task median | Per-run total median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| weavatrix-refactor 1.0.4 | **12/12 x3** | 9,170 tok | 2,521 tok | 574 tok | 235 ms | 744 ms | 1,236 ms |
| weavatrix-refactor-js 0.1.6 | **12/12 x3** | 10,489 tok | 2,096 tok | 124 tok | 650 ms | 989 ms | 1,605 ms |
| Serena, suggested flow | **7/12 x3** | 5,682 tok | 140 tok | 42 tok | 9,938 ms | 1,467 ms | 11,215 ms |
| Serena, warmed by hand | **12/12 x1** | 5,682 tok | 674 tok | 103 tok | 18,816 ms | 16,989 ms | 35,805 ms |

`Session fixed context` is the complete initialize response plus `tools/list`.
Instructions are already inside initialize and are not added twice. The fixed
breakdown is:

| Server | Initialize | Instructions within initialize | Tool catalog | Total fixed |
| --- | ---: | ---: | ---: | ---: |
| weavatrix-refactor | 79 tok | 21 tok | 9,091 tok | 9,170 tok |
| weavatrix-refactor-js | 230 tok | 68 tok | 10,259 tok | 10,489 tok |
| Serena | 122 tok | 29 tok | 5,560 tok | 5,682 tok |

This exposes the real trade-off on the toy repository: after the 1.0.4 flow
fixes, Weavatrix spends 3,095 task tokens, but its 54-tool catalog makes the
one-session total 12,265 protocol-visible tokens. Serena's failed suggested
flow spends only 5,864 total protocol-visible tokens; that lower number does
not compensate for a silently broken build.

### Real naked Codex agent

Codex CLI `0.147.0-alpha.6.5` ran three fresh copies with `--ephemeral`,
`--ignore-user-config`, `--ignore-rules`, and no MCP server. The CLI event stream
did not expose the default model id, so the result records that limitation
instead of guessing.

Two setup probes happened before the measured series and are excluded: the
first copied only `codex.exe` without its companion command host, and the
second used the default read-only sandbox. Neither completed the task or
produced a scored run. The three rows below all use the final documented
configuration and fresh fixture repositories.

| Run | Correctness | Wall time | Input tokens | Cached subset | Output tokens | Reasoning output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **12/12** | 33,638 ms | 71,363 | 52,224 | 927 | 67 |
| 2 | **12/12** | 38,913 ms | 71,779 | 46,080 | 886 | 73 |
| 3 | **12/12** | 38,475 ms | 70,566 | 52,224 | 886 | 49 |
| **Median** | **12/12 x3** | **38,475 ms** | **71,363** | **52,224** | **886** | **67** |

The previous 523-input/241-output-token, 13.11-ms number is retained only as a
**deterministic mechanical oracle**: a hand-written script reads, decides, and
rewrites the known fixture perfectly. It is not an agent benchmark. The real
agent result is roughly 71K cumulative input tokens and 38.5 seconds on this
setup, including its host context and multiple model/tool turns.

## What the benchmark caught

It found two shipping Weavatrix defects in one day. Version 1.0.1 changed a
string literal because an import-widened textual scan did not distinguish code
from quoted text. The first correction then missed a call inside a template
interpolation because the tokenizer represented the whole template as one
string token. Both failures now have regression tests; 1.0.3 and 1.0.4 score
12/12 across all three protocol runs.

It also caught Serena's cold-program boundary. The documented-looking flow,
`find_symbol` then `rename_symbol`, answered “Successfully renamed (1 changes
applied)” in all three runs after changing only the declaring file. Cross-file
imports and calls retained the old name and TypeScript failed. Manually warming
the language server with three extra calls produced 12/12 once, but took
35,805 ms at the protocol layer and nothing in the normal result told an agent
that the warm-up was required.

## Product changes driven by the result

The benchmark did not merely produce a score:

- an ambiguous bare name now returns candidate ids in the refusal, removing the
  25.9-KB `query_graph` detour from the measured flow;
- apply can consume the plan-bound token without the agent echoing the complete
  plan again;
- retained rollback backups are centralized under
  `.weavatrix/worktree` after the durable commit, while crash-time transaction
  artifacts remain adjacent only until recovery no longer needs them.

The first two changes are in `weavatrix-refactor 1.0.4`. The backup relocation
is a `weavatrix-worktree` repository change and is not included in the published
1.0.4 binary measurement above.

## Safety comparison

| Property | weavatrix-refactor | Serena | naked Codex agent |
| --- | --- | --- | --- |
| Ambiguous name | refuses with exact candidate ids | chooses the named file's match | prompt and model judgment |
| Incomplete evidence | `PARTIAL` plus named uncertain references | success message with no expected-reference baseline | model must discover omissions |
| Before writing | hash-bound preview; `STALE` if the tree moved | writes immediately | writes immediately |
| Authorization | env gate plus plan-bound single-use token | none | host policy |
| Undo | retained crash-recoverable transaction | none | Git if the agent created a baseline |

## Verdict

On this fixture the naked Codex agent is correct, but it is neither 13 ms nor a
few hundred tokens: the measured median is 38,475 ms and 71,363 cumulative input
tokens. The Weavatrix native protocol flow is 12/12 with a 1,236-ms median
transport path and 12,265 protocol-visible tokens including its full catalog,
but an actual model-driven Weavatrix run was not measured here and no synthetic
end-to-end latency is claimed. Serena's suggested flow is cheapest in tokens
and still unusable because it silently leaves the repository uncompilable;
manual warming restores correctness at a much higher measured time.

The decisive product value remains failure visibility and recoverability, not a
universal small-repository token win. The benchmark now reports exactly where
each number comes from and keeps measured agent behavior, measured server
mechanics, and deterministic scripting as three distinct evidence classes.
