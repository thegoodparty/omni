The judge needs one arm of one case before it can compare anything: drive a
real chat turn and emit a `RunRecord`. This is that runner.

## Why it goes through the real routes and a real database

There is no database-free path. `ChatStreamService` takes `ChatStoreService`
as a required constructor dependency and `stream()` makes three DB calls
before the model is reached, so a pure-fixture runner with injected ports
cannot drive a turn at all. `useTestService()` already boots the real app
against a throwaway Testcontainers Postgres with an authenticated client, so
the runner takes that context as a port and drives `POST /v1/chats` then
`POST /v1/chats/:id/messages?scope=` — guards, `loadContext`, the scope
handler's prompt and tools, the stream service, the persisted transcript, all
real. All four registered scopes are driven, including both anchor-keyed ones.

The model is the one thing stubbed. Nothing in this build spends money, and a
real turn is not reproducible anyway: three Chief of Staff turns on identical
seeded state produced 6, 4 and 2 tool steps and replies of 1831, 1135 and
1137 characters. So no test asserts turn shape; they assert the causal wiring
instead — a failing tool is counted as one, a missing org is an `infraError`
with no output, a version nobody pinned is not reported as pinned.

## Why the record is filled at three seams

Each seam is the only place the thing it captures exists.

`LlmService.streamChatCompletion` is where the rendered system prompt, the
tool names actually offered, the answering model and the turn's token usage
are visible. Usage is read there as one aggregate: `llm.service.ts` stops the
loop with `stepCountIs(maxSteps + 1)`, so a single `streamText` call spans
every step and `totalUsage` already covers the turn. Reading the AI SDK's
`usage` — the *last* step's — would undercount a tool-heavy turn by an order
of magnitude, so a test builds a fake result whose per-step and whole-loop
figures differ and asserts the whole-loop one lands on the record.

Each tool's `execute` is the only place a tool failure exists. The AI SDK
turns a throw into a tool-error result and runs the next step, so the run
still answers — with less information — and nothing downstream sees the
failure. That is the case `isComparable()` exists for: the Databricks client
resolves lazily, so a dead credential degrades both arms identically and a
judge shown two degraded answers reports a confident code regression. The
canned model swallows a tool throw the same way production does, so a counted
failure does not also cost us the answer.

`DatabricksProvider.query` is where generated SQL is captured verbatim, and
the only place a Delta version can be pinned: `VERSION AS OF` does not survive
the agent-facing SQL validator, which parses the statement. The version is
therefore spliced into SQL that has already cleared the validator whose
aggregate-only, allowlisted-column guarantees are the whole reason that tool
is safe, so only a whole number is accepted, checked both when the seam is
installed and again at splice time.

## What the record refuses to claim

`output` is read from the one row the turn's `done` frame names, not from
every assistant row in the conversation. `campaign_assistant` seeds a scripted
opener as the first assistant message, and folding it in would have the judge
compare two arms partly on boilerplate that varies with the seeded candidate.

`dataVersion` is recorded only when a query actually ran through the
instrumented provider. There is more than one token that provider can be bound
to, and it is null wherever no credential is configured, so a record that
carried the version regardless would assert a pin that never happened —
exactly the silent failure the field exists to catch. In this branch that
means `dataVersion` and `toolQueries` are empty on every run, and the pin is
proved by a direct test of the seam rather than a live query.

`configDigest` is `'unobserved'` rather than a hash of two empty strings when
the run died before reaching the model. A digest that looks real is worse than
one that says nothing was learned.

A run on a model with no rates in `pricing.ts` degrades to `infraError` with
the reason in the trace, instead of throwing the record away or costing the
run at zero. `priceUsd` throws by design — a guessed rate makes the cost delta
printed beside a verdict fiction — and every chat scope's chain falls back to
`claude-opus-4-7`, which has no rates on record. So that fallback path is not
judgeable until someone looks the Opus rates up. Flagging rather than fixing:
adding a rate is a deliberate act, not a drive-by.

## Safety of the two monkeypatches

Both patches are on process-global singletons, and this directory compiles into
the deployed image, so installing outside a test process is refused outright.
A second install on an already-patched instance throws rather than
interleaving: two overlapping runs would file one run's prompt digest against
the other's record, and restoring out of order would leave the patch on the
singleton for the life of the process. Nothing is patched until everything that
can throw has already thrown, and both restores run in a `finally`.

Tool error text is redacted and bounded before it can reach a stored record.
The Databricks statement client throws with the raw HTTP body, which echoes the
failing statement, and the voter SQL builder inlines contact ids by design. The
judge needs the failure class, never the vendor's prose.

## One thing the runner cannot do

`buildTrace` pairs a tool failure to its `tool_call` frame by tool name, in
order. That is exact for the sequential calls a turn makes, but two concurrent
calls to the same tool in one step could attach the failure to the wrong one of
them — `toolErrors` stays right either way. Pairing on the call id would fix
it, and needs `LlmTool.execute` to receive one, which is a change to
`llm.service.ts` that belongs with whoever owns that contract.

The runner can only run inside vitest, because `useTestService()` registers
`beforeAll`/`beforeEach`/`afterAll`. The seam and the record assembly stay free
of any vitest import — the model is patched by assignment rather than
`vi.spyOn` — so the orchestrator can import the runner's types, but the sweep
itself has to be invoked as `vitest run`, not `tsx`.

`districtFilters` is always null under `useTestService()`, because the harness
stubs `ElectionsService.getPositionById` to null. Constituent tools therefore
stay dark for a second, independent reason, and a sweep that wants them has to
stub that too.
