# Rename benchmark: weavatrix-refactor vs Serena vs a naked agent

2026-08-10, Windows 11, one machine, three runs per contender. Everything below
was measured over MCP stdio with a driver that records wall time and the byte
size of every request and response — bytes are the honest proxy for agent
tokens, because every response byte lands in the model's context.

## The task and the ground truth

One rename, `resolveTarget -> locateTarget`, on a four-file TypeScript fixture
that compiles before and must compile after. 12 graded checks:

- **7 must-edit sites**: the declaration, a recursive call, a call inside a
  *sibling function's template interpolation*, two imports, a call in a
  function body, and a call at module top level (no containing symbol — the
  case that hid from graph edges in the old JS 0.1.5 defect).
- **4 traps that must survive**: `resolveTargetPath` (same prefix), the name
  inside a string literal, inside a comment, and an unrelated module-local
  function with the same name (the shadow).
- **1 gate**: `tsc --noEmit` still passes.

## Results

| Contender | Correctness | Startup (median) | Task calls time | Task payload in+out |
| --- | --- | --- | --- | --- |
| weavatrix-refactor **1.0.3** | **12/12 × 3** | 0.27 s | 0.33 s | 3.4 + 34.1 KB¹ |
| weavatrix-refactor-js 0.1.6 | **12/12 × 3** | 0.65 s | 1.0 s | 0.6 + 6.2 KB |
| Serena, the flow the tools suggest | **7/12 × 3** | 9.9 s | 1.5 s | 0.3 + 0.6 KB |
| Serena, warmed by hand² | 12/12 | 9.1 s | 15.8 s | 0.7 + 2.4 KB |
| Naked agent (grep + read + write) | ungraded³ | — | — | 2.3 KB in, 1.1 KB out |

¹ 25.9 KB of it is one `query_graph` call used to disambiguate the symbol id;
the rename/preview/apply core is ~7.7 KB. A leaner candidate list in the
ambiguity refusal would cut the flow by ~70%.

² Two `get_diagnostics_for_file` calls plus one `find_referencing_symbols`
(~5.2 s each) to force the language server to load the cross-file program
before renaming. Nothing in the tool output tells an agent to do this.

³ The baseline measures what a tool-less agent must move through its context;
whether it dodges all four traps depends entirely on the model.

## What the benchmark caught, in both directions

**It caught weavatrix twice.** The shipping 1.0.1 scored 11/12: the string
literal was corrupted, because the import-line widening accepts `export ` lines
and the textual scan cannot tell an identifier from the same characters inside
quotes. The first fix scored 10/12: gating sites on Identifier tokens silently
dropped the call inside a template interpolation, because the tokenizer emits
the whole template as one String token. 0.1.3 re-tokenizes balanced `${...}`
interiors; 12/12 since, and both cases are pinned by tests.

**It caught Serena's sharpest edge.** The flow its tools suggest —
`find_symbol`, then `rename_symbol` — answered *"Successfully renamed
'resolveTarget' to 'locateTarget' (1 changes applied)"* three times out of
three, having renamed only the declaring file. Every cross-file call and import
kept the old name, the build broke, and the success message carries no
completeness signal an agent could branch on. LSP rename is precise about what
it sees; cold, it sees one file.

## The token economics, honestly

On this four-file toy the naked agent is the cheapest: ~3.4 KB moved against
~12 KB for the weavatrix core flow. Small repos do not need a refactor server.

The lines cross with repository size, because the two approaches scale on
different variables. The naked agent's cost is **the byte size of every
candidate file**: each one is read fully into context, and every changed file
is written back fully — and the written half is completion tokens, the
expensive and slow kind. The MCP flow's cost is **the number of edit sites**:
a plan entry is ~150 bytes regardless of how large the file around it is.
Rename a symbol with 60 references across thirty 20 KB files and the naked
agent moves ~1.2 MB (~300K tokens, half of it completion); the plan flow moves
roughly the same ~10-20 KB it moved here.

Two real payload costs on the weavatrix side worth engineering down: the
`tools/list` catalog is 42 KB per session (54 tools), and the plan is echoed
back by the agent twice (preview, then apply), so plan bytes are paid three
times. Serena's catalog is 25 KB for 21 tools; the JS host's is 48 KB.

## The safety comparison

| Property | weavatrix-refactor | Serena | naked agent |
| --- | --- | --- | --- |
| Ambiguous name | refuses, asks for an exact id | renames whichever `name_path` matches first in the file you name | model's judgement |
| String/comment/shadow traps | tokenizer + graph; all survived (from 1.0.3) | LSP-precise on what it sees | model's judgement |
| Incomplete result | `PARTIAL` + itemized `uncertainReferences` | "Successfully renamed (N changes applied)" with no baseline for N | unknown unknowns |
| Before writing | preview against content hashes; `STALE` if the tree moved | writes immediately | writes immediately |
| Authorization | env gate + plan-bound single-use token | none | none |
| Undo | retained transaction, `rollback_last_apply` | none | git, if committed |

## Verdict

For an agent the ranking on this task is: **weavatrix-refactor 1.0.3** —
correct, sub-second, and the only contender whose failure modes are statuses an
agent can branch on; **weavatrix-refactor-js** — equally correct here, ~3×
slower end-to-end, kept as the compatibility oracle; **Serena** — excellent
primitives, but its rename trusted cold is a silent half-rename with a success
message, and warmed it is ~40× slower than the native host; **naked agent** —
cheapest on toy repos, unbounded cost and unbounded risk everywhere else.

Known litter to fix: after an apply, `.weavatrix-*.backup` retention files are
left next to the sources, untracked. They should live under the state
directory instead.

Raw run JSON, the driver, the fixture and the grader live in the session
scratchpad (`refbench/`); the methodology is reproducible from this document.
