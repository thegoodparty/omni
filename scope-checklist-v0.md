# Scope checklist v0 (DRAFT — react to this)

The thing `/create-scope` checks against. Harvested, not invented: provenance on
every row. `[V]` gp-feature-validator · `[U]` gp-ui-tester · `[T]` create-tdd
cross-cutting prompts · `[Q]` clickup-epic-create quality bar · `[S]` Stephen's
verbatim list · `[R]` real robocall misses (the ratchet's seed rows) ·
`[N]` proposed by me, no source — argue with these first.

Rule inherited from create-tdd: **"N/A because <reason>" is a valid answer.
Silence is not.**

---

## Part 1 — per section (the repeated grid)

Asked of every page and section. This is the coverage matrix.

| # | Item | Src | Why it bites |
|---|---|---|---|
| 1 | Purpose, one line | [S] | Sections nobody can justify are usually scope creep |
| 2 | In scope, bullets | [S] | |
| 3 | **Out of scope, bullets** | [S] | Stephen names this explicitly; absent from their chain |
| 4 | **Data source per displayed element** | [S] | "The API" is not an answer. Name the table/endpoint/computed value |
| 5 | Empty state | [S][V][U] | Validator step 6: "states specs commonly skip" |
| 6 | Loading state | [V][U] | |
| 7 | Error state **and recovery** | [V][U] | Design measured 11 error refs and **0 retry** affordances |
| 8 | Permissions / entitlement | [S] | Design has proGate (48 refs) and smsGate (35). Who sees this? |
| 9 | Disabled conditions + validation messages | [U] | 59 disabled conditions in the source |
| 10 | Responsive: what changes narrow | [V][U] | 121 `isMobile` branches, 0 media queries. It IS specified, read it |
| 11 | Keyboard / focus | [U] | 87 aria attributes present. Cheap to lose, expensive to retrofit |
| 12 | Copy: final or placeholder? | [V] | Validator judges copy. If it's lorem, say so now |
| 13 | Analytics events fired | [N] | Their brief lists new Amplitude events. Unsure if this belongs per-section |

## Part 2 — per feature (asked once)

Kept OUT of the grid deliberately. These are the questions a grid makes
unreadable, and they are where the expensive misses live.

| # | Item | Src | Why it bites |
|---|---|---|---|
| 14 | **Unstated requirements** the design implies but never says | [S] | Stephen's #1. Nothing in their chain looks for these |
| 15 | **Integration register** + side-effect class per row | [S][N] | Missing integrations, and no-sandbox danger |
| 16 | Data model changes | [T] | create-tdd covers it; scope should flag that one is coming |
| 17 | Inputs and outputs, naming **user-controlled** inputs | [T] | |
| 18 | Failure, recovery, blast radius | [T] | |
| 19 | **Money**: any charge, hold, refund. What happens on partial failure | [R] | Robocall: hold placed, run stranded, money reserved forever |
| 20 | **Irreversible actions**: what cannot be undone, is there a confirm | [R] | Calls placed cannot be unplaced |
| 21 | **How does a long-running thing END?** | [R] | Robocall: CallHub never signals completion, so nothing ever settled. A start state with no terminal state is a bug you ship |
| 22 | **In-flight work when this ships** | [R] | Stranded authorized drafts. Records mid-flight at deploy |
| 23 | Migration / backfill for existing records | [N] | |
| 24 | Shared surfaces this changes for other features | [N] | The outreach flow is ONE parameterised flow across 7 channels — a robocall change can move SMS |

---

## Tiering (what makes review fast)

Every answered item is marked one of:

- **DEFAULT APPLIED** — standard pattern used. Collapsed. You skim.
- **DECISION NEEDED** — real choice, no obvious answer. Pulled to the top.
- **ASSUMPTION MADE** — the agent guessed. Pulled to the top.

Reviewer reads the top block only. The grid sits underneath for audit and for
the gate check (any empty cell fails).

## Open questions on the checklist itself

1. Is item 13 (analytics) per-section or per-feature? It feels per-feature.
2. Item 11 (keyboard/focus) — real scope line, or an engineering default that
   never needs product's opinion?
3. Items 23 and 24 are mine with no source. Keep, cut, or reword?
4. Anything here that has NEVER burned you? Cut it. A checklist nobody believes
   gets skipped wholesale.
5. What is missing? The ratchet rows [R] come from robocall only, because that
   is the failure history I have. Other features will have other rows.
