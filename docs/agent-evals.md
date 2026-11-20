# Writing agent evals

## Pick the test that answers your question

| What are you testing? | Use | What it needs |
| --- | --- | --- |
| Does one version give a known right answer? Examples: a PII gate, classifier, or guardrail. | Expected-result suite | Runs in process, without a deployment. Needs a judge model only if `judge` calls `judgeModel`. |
| Did a prompt change, model swap, or engine migration make the agent better or worse than main? | Pairwise suite (the universal judge) | Two running gp-api instances, normally deployed dev and a PR preview. |
| Is deterministic code correct without a model? | Plain unit test, not an eval | See [testing](testing.md). |
| Did a change make a chat agent better or worse than main? | Pairwise suite that drives the chat routes (`chatTurns`, `briefingChatTurns`) | Two running instances, as for any pairwise suite. See [Chat suites](#chat-suites). |
| Does a chat prompt meet a behavioral contract against a real LLM? | [Chat prompt evals](../packages/gp-api/src/chats/evals/README.md) | Opt-in Vitest tests for existing chat contracts. |
| Is the Chief of Staff meeting an existing golden benchmark? | [Chief of Staff golden bench](../packages/gp-api/src/chats/general/chief-of-staff/evals/README.md) | Use its curated conversation cases and rubric for that benchmark. |
| Are you comparing chats through the existing `/judge` workflow? | [Universal judge for chats](../packages/gp-api/src/chats/evals/judge/README.md) | Use it to reproduce its existing chat comparisons. Use the universal judge for new deployed agent comparisons. |
| Are you evaluating completed PMF experiment runs or working on the Python AI sandbox? | [PMF experiment evals](../packages/runbooks/experiment-evals/AGENTS.md) or [Braintrust sandbox](../packages/gp-ai/braintrust_eval_sandbox/README.md) | Use the experiment's rubric for stored runs, or the sandbox for Python AI experiments. |

## Expected-result suites

Put the suite in a `*.eval.ts` file. Export `defineExpectedResultEvalSuite(name, { run, judge, cases })` as the default. `run` defines the input and output types. `judge` takes that output and defines the judgment type. Cases must supply an `input` and `expected` that match those types; they do not influence inference.

Use a deterministic `judge` when the output has a value you can check directly. Otherwise, call `ctx.judgeModel(schema, prompt)` for a structured judgment. The judge also receives `ctx.input`. Each case runs three times and every judgment must equal `expected`. Use `await ctx.annotate(message, type)` in `run` to show useful intermediate results in Vitest. Model judging adds prompt and judgment annotations.

```ts
import { defineExpectedResultEvalSuite } from '@goodparty_org/judge'
import { classifyMessage } from './classifyMessage'

export default defineExpectedResultEvalSuite('message_classifier', {
  run: async (input: string) => classifyMessage(input),
  judge: async (output) => output.label,
  cases: [{ id: 'thanks', input: 'Thank you!', expected: 'gratitude' }],
})
```

See [the case scout gate suite](../packages/gp-api/src/caseScout/caseScoutGate.eval.ts) for a full example. Omni is public. Never commit private or real data. Load it at run time from a private location and keep it out of annotations and shared reports.

## Pairwise suites

Default-export `definePairwiseAgentEvalSuite<Input>(name, { mode, profile, run, cases })`. `mode` is `win` or `serve`. `profile` sets the test identity and its campaign race and election state, or its elected office and term. Each attempt on each side gets a fresh test user and org. A case supplies an `id`, `input`, optional async `setup(ctx)`, and optional `grading`. Set up state through the signed-in API or another agent, not by writing database rows. Return the text to grade from `run(input, ctx)`.

Use `ctx.runAgent(name, input)` for background agents. It starts a run and polls the run routes, which exist only in dev and previews. The routes pick the engine. Read the returned status and artifact rather than choosing an engine inside the suite.

| Field | When to add it | Example |
| --- | --- | --- |
| `condition` | The grader needs context that the output does not show. | The district had no public meetings in the requested period. |
| `handledWhen` | There is a concrete pass/fail requirement for each output. | Each reported issue includes a dated source from the supplied material, or the reply says there is insufficient evidence. |
| `dimensions` | A case needs a scored quality measure beyond the defaults. Each named question is scored from 1 to 5. | `specificity`: Does the reply name the decision, not just the topic? |

The grader cannot verify that a cited source is real. Use `handledWhen` for grounding rules the grader can check against the material it sees. Use independent verification when you need to establish that a source exists.

The judge compares blinded outputs in both orders for each of three attempts per case. The suite looks for a meaningful difference in wins or a regression in `handledWhen`. Only **WORSE** and **CAN'T JUDGE** fail the suite. See [the trending issues suite](../packages/gp-api/src/communityIssues/trendingIssuesAgent/trending_issues.eval.ts).

### Chat suites

A chat agent has no run route to poll. The turn streams and the reply is the SSE
body, so a chat suite posts each turn to the conversation it opened as the case's
own test user and returns the transcript.

`chatTurns(ctx, { scope, turns, anchor? })` opens `POST /v1/chats` and posts each
turn to `POST /v1/chats/:conversationId/messages`. `briefingChatTurns(ctx,
{ meetingDate, anchor, turns })` is the exception: a briefing conversation is
created together with the annotation it hangs off, so it opens `POST
/v1/briefing-chats` and posts to `/v1/briefing-chats/:annotationId/messages`.
`POST /v1/chats` refuses the `briefing_annotation` scope on purpose.

Both return the turns as `User: …\nAssistant: …` blocks, which is the text the
grader reads, and annotate each turn so a failed attempt shows the replies. A
turn that streamed an `error` frame, or that ended without its `done` frame,
throws rather than returning the text so far: a truncated answer is not a
comparable output. `tool_call`, `tool_result` and `ping` frames are ignored.

`ordinance_flow` and `priority_flow` refuse a conversation with no anchor, so a
suite creates the resource through the product's own route in `setup` and passes
its anchor. Those suites also set the office through `profile`, because the
constituent-data tools resolve the district from it.

The five chat suites are
[campaign_assistant](../packages/gp-api/src/chats/general/campaign-manager/campaign_assistant.eval.ts),
[chief_of_staff](../packages/gp-api/src/chats/general/chief-of-staff/chief_of_staff.eval.ts),
[ordinance_flow](../packages/gp-api/src/chats/general/ordinance-flow/ordinance_flow.eval.ts),
[priority_flow](../packages/gp-api/src/chats/general/priority-flow/priority_flow.eval.ts),
and
[briefing_annotation](../packages/gp-api/src/chats/briefing-chats/briefing_annotation.eval.ts).
They replaced the old judge's chat case lists, case for case: an old list's
`question` is the suite's one turn, `caseId` is the case `id`, and a case the old
list marked `scored: false` is a normal case whose `condition` starts with
`Control:`. Run one with `/judge-eval <file stem>`.

## Run evals

From the repo root:

```sh
npm run eval -w packages/gp-api
npm run eval -w packages/gp-api -- caseScoutGate.eval.ts
```

A pairwise run prints its verdict table only with the judge's reporter. Add it next to Vitest's default reporter:

```sh
npm run eval -w packages/gp-api -- trending_issues --reporter=default --reporter=../judge/src/reporter.ts
```

| Suite | Environment |
| --- | --- |
| Expected result | Set the agent's own credentials if needed. If `judge` calls `judgeModel`, also set `JUDGE_MODEL` and the judge provider's key. |
| Pairwise | Set `JUDGE_BASE_URL` and `JUDGE_CANDIDATE_URL` to the arm roots, `CLERK_SECRET_KEY` for dev Clerk, and `JUDGE_MODEL` plus the judge provider's key. The candidate may be a locally running API with the required routes. Missing arm URLs skip pairwise suites unless `JUDGE_REQUIRE_PAIRWISE=true`, which makes them fail. |

`JUDGE_MODEL` is a provider/model ID. For example, `anthropic/claude-sonnet-5-5` uses `ANTHROPIC_API_KEY`. An unmapped prefix falls back to the AI SDK gateway and uses `AI_GATEWAY_API_KEY`. The [judge resolver](../packages/judge/src/model.ts) does not expose a base-URL setting for Bifrost.

On a PR, comment `/judge-eval <suite>` using the pairwise file stem, for example `/judge-eval trending_issues`. The [workflow](../.github/workflows/judge-eval.yml) compares dev and the PR preview. Look for the verdict table in the job summary and a one-line PR comment linking to it. A WORSE or CAN'T JUDGE verdict fails the check. So does a case with no judged pairs, an unknown suite, or another test or workflow error.

## Read the results

Start with Vitest annotations. They show the evidence for an individual attempt, such as intermediate results, excerpts, and grading. For expected results, compare the expected judgment with the actual one. For pairwise suites, look at the verdict table first and then inspect the attempts behind it.

| Verdict | Meaning |
| --- | --- |
| BETTER | The comparison found evidence in favor of the candidate. |
| NO DIFFERENCE FOUND | The comparison did not establish a difference. This does not prove equivalence. |
| WORSE | The comparison found a regression in preference or in a `handledWhen` requirement. |
| CAN'T JUDGE | No pairs were judged, or more than half were not judged. |

For CAN'T JUDGE, inspect the failed attempts and arm reachability. Check preview health, credentials, agent run failures, and grader errors. Fix the cause and run again. Do not count missing judgments as ties or as evidence that the candidate passed.

## Code reference

| Export from `@goodparty_org/judge` | Source | Use |
| --- | --- | --- |
| `defineExpectedResultEvalSuite` | [expectedResult.ts](../packages/judge/src/expectedResult.ts) | Define and register known-answer cases. |
| `ExpectedResultEvalCase` | [expectedResult.ts](../packages/judge/src/expectedResult.ts) | Type an expected-result fixture. |
| `ExpectedResultEvalSuite` | [expectedResult.ts](../packages/judge/src/expectedResult.ts) | Type a defined expected-result suite. |
| `ExpectedResultRunContext` | [expectedResult.ts](../packages/judge/src/expectedResult.ts) | Type a run callback's context. |
| `ExpectedResultJudgeContext` | [expectedResult.ts](../packages/judge/src/expectedResult.ts) | Type the judge context with input and model helper. |
| `Annotate` | [annotation.ts](../packages/judge/src/annotation.ts) | Type an annotation callback. |
| `JudgeModel` | [judgeModel.ts](../packages/judge/src/judgeModel.ts) | Type a schema-based model judgment call. |
| `definePairwiseAgentEvalSuite` | [pairwise.ts](../packages/judge/src/pairwise.ts) | Define and register a comparison suite. |
| `chatTurns` | [chatTurns.ts](../packages/judge/src/chatTurns.ts) | Drive a scoped chat conversation and return its transcript. |
| `ChatTurnsInput` | [chatTurns.ts](../packages/judge/src/chatTurns.ts) | Type a scoped chat suite's case input. |
| `ChatScope` | [chatTurns.ts](../packages/judge/src/chatTurns.ts) | The scopes `POST /v1/chats` accepts. |
| `briefingChatTurns` | [chatTurns.ts](../packages/judge/src/chatTurns.ts) | Drive a briefing chat, which opens on its annotation's own routes. |
| `BriefingChatTurnsInput` | [chatTurns.ts](../packages/judge/src/chatTurns.ts) | Type a briefing chat suite's case input. |
| `BriefingChatAnchor` | [chatTurns.ts](../packages/judge/src/chatTurns.ts) | Point a briefing chat at a passage, or at all nulls for the whole briefing. |
| `PairwiseAgentEvalSuiteDefinition` | [suite.ts](../packages/judge/src/suite.ts) | Type a pairwise definition before registration. |
| `PairwiseAgentEvalSuite` | [suite.ts](../packages/judge/src/suite.ts) | Type a defined pairwise suite. |
| `isPairwiseAgentEvalSuite` | [suite.ts](../packages/judge/src/suite.ts) | Identify a pairwise suite export. |
| `EvalCase` | [suite.ts](../packages/judge/src/suite.ts) | Type a pairwise fixture. |
| `CaseGrading` | [suite.ts](../packages/judge/src/suite.ts) | Type case-specific instructions for the grader. |
| `EvalMode` | [suite.ts](../packages/judge/src/suite.ts) | Select a Win or Serve identity. |
| `SuiteProfile` | [suite.ts](../packages/judge/src/suite.ts) | Describe the test identity and its starting state. |
| `EvalContext` | [suite.ts](../packages/judge/src/suite.ts) | Type setup and run context for the current arm. |
| `EvalApi` | [suite.ts](../packages/judge/src/suite.ts) | Type the signed-in API client. |
| `AgentRunResult` | [suite.ts](../packages/judge/src/suite.ts) | Read a background run's status, artifact, or error. |
| `AgentRunStatus` | [suite.ts](../packages/judge/src/suite.ts) | Type a run's lifecycle state. |
