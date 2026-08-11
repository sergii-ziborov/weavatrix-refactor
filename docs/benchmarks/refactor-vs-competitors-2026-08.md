# Rename benchmark: Weavatrix Refactor vs Serena vs naked Codex

Measured on 2026-08-11 on one Windows 11 machine. Every time below is an
observed wall-clock duration in milliseconds. Token counts are tokens, never
payload bytes.

The reproducible harness, fixtures, grader, raw results, and generated summaries
are under [`benchmarks/rename-agent`](../../benchmarks/rename-agent/README.md).
The two machine-readable summaries are
[`summary.json`](../../benchmarks/rename-agent/results/2026-08-11-v2/summary.json)
and
[`rename-profile-summary.json`](../../benchmarks/rename-agent/results/2026-08-11-v2/rename-profile-summary.json).

## Pinned subjects

- Weavatrix full surface: `weavatrix-refactor 1.0.5`, core `2.5.1`, refactor
  engine `0.1.6`.
- Weavatrix rename surface: local `1.0.6` candidate from this repository.
- Serena: commit `f1d78a88cec2031d6b699c9944839979e9a0175d`.
- Agent: Codex CLI `0.147.0-alpha.6.5`, model `gpt-5.6-sol`, reasoning effort
  `medium`. The model and effort were explicit, not inferred from a default.

`gpt-5.6-sol` and medium effort were selected using the
[official OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model).

## Ground truth

The benchmark has equivalent TypeScript, Rust, and Python repositories. Each
fixture requires seven symbol edits while preserving four traps:

- declaration, recursive call, nested interpolation/formatting call, two
  imports, an ordinary call, and a module-level call must change;
- a longer identifier, string literal, comment, and unrelated local shadow must
  not change;
- the language build or test gate must still pass.

The independent grader therefore reports a score out of 12. Every contender
gets a fresh fixture for every run.

## Two layers, deliberately not merged

The protocol layer executes fixed MCP call sequences with no model. It measures
server startup/calls and counts exact `o200k_base` tokens for initialization,
the catalog, tool arguments, and tool results.

The agent layer runs a real coding agent end to end. Its `turn.completed` usage
already includes the model host, repeated context, MCP catalog/instructions,
tool calls, tool results, file operations, and planning. Protocol tokens are
not added again. Cached input is shown as a subset of input, not subtracted.
Each tool arm also carries a sanitized call audit: expected MCP server/method,
call counts, manual file-change count, and source-writing command count. The
harness rejects a tool arm that does not use its required rename method or that
writes source outside that MCP. Arguments, results, paths, and event streams are
not published.

No tokens-per-second estimate is used anywhere.

## Protocol layer: three runs per cell

`Fixed input` is initialization plus the tool catalog. `Call output` is the
model-side tool argument that a real agent would have to generate. `Result
input` is the tool result added to its context.

| Flow | Language | Correct runs | Median total | Fixed input | Call output | Result input | Total visible |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Weavatrix 1.0.5 full | TypeScript | **3/3** | **117 ms** | 9,331 | 124 | 2,295 | 11,752 |
| Weavatrix 1.0.5 full | Rust | **3/3** | **81 ms** | 9,331 | 128 | 2,295 | 11,752 |
| Weavatrix 1.0.5 full | Python | **3/3** | **133 ms** | 9,331 | 126 | 2,275 | 11,732 |
| Serena suggested | TypeScript | **0/3** (7/12 each) | 6,890 ms | 5,682 | 42 | 140 | 5,864 |
| Serena suggested | Rust | **3/3** | 13,539 ms | 5,682 | 42 | 140 | 5,864 |
| Serena suggested | Python | **3/3** | 17,477 ms | 5,682 | 42 | 140 | 5,864 |
| Serena warmed | TypeScript | **3/3** | 21,571 ms | 5,682 | 103 | 674 | 6,459 |
| Serena warmed | Rust | **3/3** | 35,249 ms | 5,682 | 103 | 677 | 6,462 |
| Serena warmed | Python | **3/3** | 16,169 ms | 5,682 | 103 | 646 | 6,431 |

The suggested Serena flow is `find_symbol` then `rename_symbol`. On TypeScript
it returned success after changing only the declaring file in all three runs;
the cross-file imports and calls remained stale. That defect did not reproduce
on the Rust or Python fixtures, so it is language-server-state dependent rather
than a universal Serena failure. Manual diagnostics/reference warm-up restored
TypeScript correctness, but cost substantially more time.

## Agent layer: same model, three runs per cell

| Arm | Language | Correct / operational | Median wall | Median input | Cached subset | Output | Reasoning output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Naked Codex | TypeScript | **3/3 · 3/3** | **42,602 ms** | **72,169** | 56,064 | 1,043 | 64 |
| Weavatrix full | TypeScript | **3/3 · 3/3** | 58,719 ms | 275,784 | 236,288 | 1,255 | 315 |
| Serena | TypeScript | **3/3 · 3/3** | 68,728 ms | 388,271 | 340,480 | 1,387 | 381 |
| Naked Codex | Rust | **3/3 · 3/3** | **38,502 ms** | **71,912** | 65,280 | 1,009 | 71 |
| Weavatrix full | Rust | **3/3 · 3/3** | 65,088 ms | 395,712 | 349,184 | 2,013 | 514 |
| Serena | Rust | **3/3 · 3/3** | 84,204 ms | 283,041 | 245,248 | 1,362 | 460 |
| Naked Codex | Python | **3/3 · 3/3** | 98,780 ms | **237,239** | 207,360 | 2,943 | 436 |
| Weavatrix full | Python | **3/3 · 3/3** | **96,633 ms** | 459,029 | 415,232 | 2,520 | 678 |
| Serena | Python | **3/3 · 3/3** | 121,888 ms | 601,627 | 530,432 | 2,165 | 658 |

The real Serena agent did better than the fixed suggested protocol: it loaded
Serena's instructions, called `find_referencing_symbols`, and then renamed. That
extra reasoning recovered 12/12 on TypeScript, but it also explains why the
agent result is much larger than the two-call protocol result.

## Measured rename-only surface

The full Weavatrix catalog was the dominant repeatable cost. Version 1.0.6 adds
`--profile=rename`, which exposes only `rename_symbol` and
`rollback_last_apply`, refuses hidden tools, and gives the agent the exact
bare-name → candidate → preview → apply workflow. It preserves hashes,
`PARTIAL`, the write gate, the single-use token, and drift-safe rollback.

Protocol result across nine runs:

| Language | Correct runs | Median total | Fixed input | Total visible |
| --- | ---: | ---: | ---: | ---: |
| TypeScript | **3/3** | 223 ms | **485** | 2,914 |
| Rust | **3/3** | 333 ms | **485** | 2,908 |
| Python | **3/3** | 459 ms | **485** | 2,885 |

The fixed catalog/context fell from 9,331 to 485 tokens (94.8%) without a
correctness regression. A second, guided TypeScript agent A/B produced:

| Arm | Correct runs | Median wall | Median input | Cached subset | Output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Weavatrix 1.0.5 full | **3/3** | 58,719 ms | 275,784 | 236,288 | 1,255 |
| Weavatrix 1.0.6 rename profile | **3/3** | **48,389 ms** | **108,155** | 83,456 | **799** |
| Naked Codex | **3/3** | **42,602 ms** | **72,169** | 56,064 | 1,043 |

The profile reduces Weavatrix median input by 60.8% and wall time by 17.6%
versus the full surface. It still does not beat naked Codex on this toy
TypeScript repository: it is 13.6% slower and uses 49.9% more input tokens.

## Defects the expanded fixtures found

The cross-language expansion found two real Weavatrix evidence gaps before the
1.0.6 release candidate:

- Rust calls inside standard formatting macros were omitted from rename edges;
- Python recursive, module-level, and f-string expression calls were incomplete.

Both were reproduced by the 12-check fixtures, fixed in the parser/core/refactor
stack, and protected by regression tests. The benchmark is therefore serving
its primary purpose: finding unsafe omissions before marketing them as speed.

## Safety comparison

| Property | Weavatrix Refactor | Serena | Naked Codex |
| --- | --- | --- | --- |
| Ambiguous name | refusal with exact candidate ids | path/name selection | model judgment |
| Incomplete evidence | `PARTIAL` plus named uncertain references | no expected-reference baseline | model must detect it |
| Before writing | hash-bound preview; stale trees refuse | immediate write | immediate write |
| Authorization | env gate plus plan-bound single-use token | none | host policy |
| Undo | retained, drift-checked rollback | none | Git only if prepared |

## Verdict

The product is useful, but the honest value today is safe failure visibility and
recovery, not a universal token or latency win. Naked Codex wins the small
TypeScript and Rust agent tests. Weavatrix narrowly wins Python wall time while
using more input. Serena is correct when the agent performs extra reference
work, but is slower and substantially more context-heavy in this setup.

The demonstrated contract is preview before write, named uncertainty,
stale-plan refusal, explicit authorization, and rollback. The measured profile
improvement does not show that Weavatrix is cheaper than a naked agent on small
repositories.
