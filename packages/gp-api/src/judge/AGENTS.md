# Judge turn telemetry

Per-turn observations the Universal Judge's chat arms write as they run and
read back over HTTP. Judge-only and non-prod-only. Nothing a candidate or an
elected official does reaches any of this.

It exists because the arms are moving off in-process monkeypatches
(`src/chats/evals/judge/runners/chatSeam.ts`) and onto driving a deployed
gp-api. A patch on `DatabricksSqlProvider.prototype` observes nothing once the
agent runs in another process behind an HTTP boundary.

The reader is `httpChatRuntime.ts`, reached with `JUDGE_ARM_RUNTIME=http`. It
**polls** this route for 15 seconds after every turn rather than reading once,
because the write below is fire-and-forget, and it waits for the next
`turnIndex` after the last one it saw rather than for a number it computed —
`history.length` counts a scope's scripted opener and saturates at the replay
window, so no arm can predict it.

## Shape

| Path                                     | What                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `judgeTelemetry.util.ts`                 | Pure derivations: the discriminator, the prompt hash, the tool columns |
| `services/judgeTurnTelemetry.service.ts` | The upsert the chat stream calls, and the owner-scoped read            |
| `guards/judgeTelemetryAccess.guard.ts`   | Class-level gate: non-prod deploy and the judge user, both 404         |
| `judge.controller.ts`                    | `GET /v1/judge/conversations/:id/turns`                                |

The write is appended to the post-drain block in `ChatStreamService.run`, next
to `recordAssistantUsage`. That block is where token usage resolves, and it is
the one place the tool events, the prompt the provider was handed, the
conversation and the assistant row are all in scope together. It is
fire-and-forget: a failed telemetry write must never cost a user their turn.

`GeneralChatsService.sendMessage` decides whether a turn is a judge turn, from
the organization slug already on the conversation row it loaded.
`BriefingChatsService` does not: its context carries no organization slug, so
briefing turns record nothing.

## Two columns that do not yet mean what they say

- **`sweepId` is a per-case run key, not a sweep id.** A chat arm's
  organization is slugged `judge-<agentId>-<caseId>-<digest>` by
  `seedChatOrg.chatOrgSlug`, which never embeds the sweep. The sweep id lives
  in the arm process's `JUDGE_SWEEP_ID` and does not cross the wire. Grouping
  by this column groups by case. Fix: have the arm send its sweep id.
- **`dataVersion` is always null.** The Delta version a turn read comes from
  the `VERSION AS OF` rewrite the in-process provider patch performs. A
  deployed gp-api neither pins nor reports one, and the warehouse response
  carries columns and rows only.

One column means something narrower than its in-process twin, which is not a
defect but is worth knowing: `toolNames` here is the tools the turn CALLED,
while the in-process capture records the tools the model was OFFERED. The
judge's `configDigest` is built from whichever it has, and says which in its
own prefix. Adding the offered set is what would make the two digests
comparable.

`toolQueries` needs no such caveat: `query_constituent_data` and
`district_insights` both take `sql` as a tool input, so the agent's SQL is
already in the turn's tool events.
