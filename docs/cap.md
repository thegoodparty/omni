# CAP — the Civic Agent Platform

CAP ("Civic Agent Platform") is the org-wide name for everything GoodParty does to
run AI agents on behalf of candidates and elected officials. It is two systems that
share a goal and almost no code:

1. **Background agents** — an agent runs unattended, in its own sandbox, for one
   org, and produces a structured **artifact** (a meeting briefing, a community
   issues report, opposition research). Dispatched and reconciled by gp-api;
   executed in `gp-ai-projects`. **Read [`cap-background-agents.md`](cap-background-agents.md).**
2. **Interactive agents** — a synchronous, streaming chat agent answers a user in
   real time, calling tools as it goes (the Chief of Staff assistant, the briefing
   chat). Built entirely in gp-api on the Vercel `ai` SDK.
   **Read [`cap-interactive-agents.md`](cap-interactive-agents.md).**

The two meet at exactly one seam: interactive agents **read** the artifacts that
background agents **produce**. Nothing else crosses.

## Naming — what this thing is called in code

"CAP" is the name we say out loud. The code almost never uses it. Before you go
grepping, know the aliases:

| You hear / read              | In the code it's…                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| CAP, "the platform"          | nothing — it's an umbrella term, not a module                                         |
| "agent infrastructure"       | the **PMF Engine** — `gp-ai-projects/pmf_engine` + `broker`                           |
| "background agents"          | **experiment runs** — `gp-api/src/agentExperiments`, `ExperimentRun` (Prisma)         |
| "an experiment"              | a **run-type** (a manifest in S3): `meeting_briefing`, `top_community_issues`, …      |
| "a run" / "a job"            | one execution of an experiment for one org (`run_id`)                                 |
| "the eval system"            | `packages/runbooks/{books,experiment-evals,scripts}` (the gates), Braintrust (traces) |
| "interactive agent"          | **`LlmService`** + the chat surfaces in `gp-api/src/chats`                            |
| "the COS" / "Chief of Staff" | the one registered interactive chat scope (`chief_of_staff`)                          |

"PMF" is product/market-fit: the engine exists to test, against real candidates,
whether AI-generated artifacts are good enough to build a product on. The framing
stuck even though the engine is now generic infrastructure.

## Where the code lives (cross-repo)

CAP spans two repos. `gp-ai-projects` is a **separate external repo**
(`~/Repos/thegoodparty/gp-ai-projects`), not a package in this monorepo — the agent
runtime, the broker, and the dispatch/scheduler Lambdas live there in Python. This
monorepo holds the gp-api transport layer, the products, the SDK/contracts, and the
eval system (`packages/runbooks`).

```
                 INTERACTIVE                         BACKGROUND
                 (this repo only)                    (spans both repos)

  user ─chat─▶ gp-api/src/chats ──┐         gp-api/src/agentExperiments
                                  │                    │  dispatchRun()
              gp-api/src/llm      │                    ▼  SQS (agent-dispatch.fifo)
              (LlmService,        │         ┌──────────────────────────────────┐
               Vercel `ai` SDK)   │         │  gp-ai-projects (external repo)   │
                    │             │         │   pmf_engine  ──RunTask──▶ runner │
              Anthropic /         │         │   (Lambdas)              (Fargate)│
              Together            │         │       │ every call proxied via    │
                                  │         │       ▼   the broker              │
                                  │         │     broker (FastAPI/ECS)          │
                                  │         └──────────┬───────────────────────┘
                                  │           artifact │ S3: gp-agent-artifacts
                                  │         result SQS │ ▼
                                  └─reads artifacts◀────┴─▶ gp-api reconciles run,
                                    (one-directional)        stores S3 key, products
                                                             consume artifact
                                                                  │
                                              eval (packages/runbooks): reads S3
                                              artifacts + traces, gates prompt changes
```

## The 60-second mental model

**Background.** A product module in gp-api (meetings, communityIssues,
campaignStrategy) decides an org needs an artifact and calls
`ExperimentRunsService.dispatchRun(...)`. That writes a `QUEUED` `ExperimentRun` row
and drops a message on an SQS FIFO queue. In `gp-ai-projects`, a dispatch Lambda
validates the request against the experiment's S3 manifest and enqueues it in a
DynamoDB job table; a single-concurrency scheduler Lambda is the only thing that
launches Fargate tasks, so the live-agent count is an exact, SSM-tunable ceiling.
The Fargate **runner** runs a Claude Agent SDK loop whose every external call —
Anthropic, web fetch, Databricks, artifact publish — is forced through the
**broker**, a trusted proxy that holds all credentials and is the only thing the
otherwise-quarantined agent can reach. The agent writes a JSON artifact, the broker
validates it against the manifest's output schema and uploads it to S3, then a result
SQS message flows back to gp-api, which reconciles the run's status and lets the
product module persist the artifact.

**Interactive.** A user opens a chat. gp-api's `LlmService` calls `streamText` from
the Vercel `ai` SDK, routes to Anthropic (Claude) or Together based on the model id,
loops through tool calls (query voter data, read briefings, manage priorities), and
streams the result back over SSE. Prompts are assembled in code; conversations are
persisted in normalized Postgres tables.

**Eval.** For background agents, `packages/runbooks` holds a two-axis eval system
that reads real runs' artifacts and traces out of S3 and gates prompt changes — a
mechanical performance gate that can block, and an LLM-as-judge quality rubric that
only advises. For interactive agents there is **no comprehensive eval yet**; this is
a known, growing area of investment.

## Glossary

- **Experiment** — a run-type, defined by a **manifest** (`manifest.json` +
  `instruction.md` + attachments) published to the `agent-experiment-metadata` S3
  bucket from `packages/runbooks`. Defines model, timeout, input/output JSON schemas,
  and Databricks scope.
- **Run** — one execution of an experiment for one org, identified by `run_id`.
  Tracked as an `ExperimentRun` in gp-api and a job row in `gp-ai-projects`' DynamoDB.
- **Artifact** — the JSON work product a run produces. Stored in S3; gp-api stores
  the **key**, not the body, and re-fetches on demand.
- **Resource location** — the `{artifactBucket, artifactKey}` pair that points at an
  artifact in S3.
- **Broker** — the trusted egress proxy in `gp-ai-projects`; the security boundary
  for every background run.
- **Manifest** — the S3-published definition of an experiment.
- **ICP gate** — "ideal customer profile" gate; automated background dispatch only
  fires for orgs whose office is flagged `isServeIcp` (sourced from Databricks via
  election-api). Fails closed.
- **Chat scope** — the interactive-side abstraction (`ChatScopeHandler`) for a kind
  of chat; today only `chief_of_staff` is registered.

## Pointers

| You're doing                                            | Read                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Understanding / changing a background agent             | [`cap-background-agents.md`](cap-background-agents.md)                                       |
| Understanding / changing an interactive chat            | [`cap-interactive-agents.md`](cap-interactive-agents.md)                                     |
| The gp-api transport layer for runs                     | `packages/gp-api/src/agentExperiments/CLAUDE.md`                                             |
| Writing/running an eval, changing a prompt safely       | `packages/runbooks/books/pmf-eval-system.md`                                                 |
| Bulk-dispatching a cohort (briefings, community issues) | the `bulk-briefing-cohort` / `bulk-community-issues-cohort` skills                           |
| The agent runtime, broker, dispatch internals           | `gp-ai-projects/pmf_engine/control_plane/README.md`, `gp-ai-projects/broker/ARCHITECTURE.md` |
