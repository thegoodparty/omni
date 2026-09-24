# Product vocabulary — Win and Serve

Two products share most of the code. They do not share nouns.

**Win** is for candidates running for office. **Serve** is for elected
officials already in office. A Serve user reading "voters" or "your campaign"
is reading about someone else's life, and this has now regressed four times.
Read this file before writing any string on a surface either product can
reach. Copy rules (titles, captions, tone) are `product-copy.md`; this file is
only about which words belong to whom.

## The two vocabularies

| Idea                  | Win                       | Serve                              |
| --------------------- | ------------------------- | ---------------------------------- |
| The people            | voters                    | constituents                       |
| Where they live       | the district              | the district                       |
| The list of people    | voter file, voter list    | constituent file, constituent list |
| The user's mandate    | the campaign, the race    | the office, the term               |
| The user              | candidate                 | elected official                   |
| The date that matters | election day              | the council/board meeting          |
| Getting access        | getting on the ballot     | (nothing — they already hold it)   |
| The AI assistant      | Campaign Manager          | Chief of Staff                     |
| A door answer         | supporter / non-supporter | spoke with / needs follow-up       |

## Banned in Serve

`voter` · `voters` · `voter file` · `election` · `elections` · `electoral` ·
`candidate` · `candidates` · `ballot` · `ballots`

Not banned, and load-bearing for a Serve official: **`vote`**, **`voting`**,
**`elected`**, **`term`**, **`office`**. A legislative vote is the job.

Nothing here is banned in Win. **Win copy must not change to fix a Serve
bug** — see "How to fix it" below.

## "campaign" has two senses, and only one is banned

Serve has no run for office. Serve does send outreach campaigns.

| Sense                                                 | In Serve | Examples                                                                                                                         |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **An outreach campaign** — a thing the official sends | Fine     | "Campaign name", "Outreach campaign history", "Any phone banking campaign", "Name your campaign"                                 |
| **A run for office** — the user's candidacy           | Banned   | "Checking your campaign tone", "Built from your campaign", "Campaign Manager" (as a role label), "campaigns from earlier cycles" |

The test: could a city councilmember four years into a term read this
sentence about themselves? "Your text campaign goes out Monday" — yes.
"Checking your campaign tone" — no, they have no campaign.

## How to fix it

**Never rename the Win string.** The two surfaces mount the same components
(`app/dashboard/outreach/v2/` is the whole Serve outreach flow), so renaming in
place breaks Win to fix Serve. Give the shared component a **mode-keyed copy
object** or an **`isServe` argument** instead.

Four shapes, all already in the repo. Pick the smallest one that fits.

| Shape                        | When                                           | Model                                                                                                        |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A full mode-keyed label set  | A surface whose every noun changes             | `packages/gp-webapp/app/dashboard/shared/contactsLabels.ts` — `getContactsLabels(isWin)`. The gold standard. |
| A sparse override record     | Most labels survive the change of vocabulary   | `.../door-knocking/native/statusPresentation.ts` — `statusLabel(status, isServe)` over `SERVE_STATUS_LABELS` |
| A spread over the Win object | A copy object gains a few Serve-framed strings | `.../outreach/v2/phone-banking/PhoneBankingFlow.tsx` — `SERVE_PHONE_BANKING_AUDIENCE_COPY`                   |
| A function of `isServe`      | A derived list or column set                   | `.../door-knocking/print/walkFacts.ts` — `walkColumns(isServe)`                                              |

Two more cases that are not copy:

- **Win-only inputs.** Strip the field rather than reword it:
  `.../contacts/crm/wizard/VoterFileStep.tsx` and
  `.../door-knocking/native/createFlow/WhoStep.tsx` drop Win-only filters when
  `isElectedOfficial` / `isServeOrg`.
- **LLM prompts.** The vocabulary belongs in the prompt, not in a post-edit:
  `packages/gp-api/src/outreach/services/outreachSocialGeneration.service.ts` —
  `SocialVoiceConfig` with `WIN_SOCIAL_VOICE` / `SERVE_SOCIAL_VOICE`.

**Prefer a mode-keyed object over an `isServe ? a : b` ternary.** Not style:
the automated check below reads `SERVE_*` declarations and `serve:` branches,
and a ternary's strings are invisible to it.

## The automated check

`packages/gp-webapp/scripts/serveVocabulary.ts` reads a TypeScript AST and
flags a banned word in **Serve copy** — not merely in a file Serve reaches,
since the shared flows are full of Win copy that must not change. It looks at:

1. every string in a file under a Serve-only route (`SERVE_ONLY_DIRS`)
2. the initializer of any `SERVE_*` declaration, anywhere
3. the value of any `serve:` key in a mode-keyed object, anywhere

Comments, imports, object keys, route paths, enum values (`not_a_voter`),
`className`s and strings being compared are not copy, and are not flagged.

Three layers run it:

| Layer         | What                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent context | This file, pointed at from the root `AGENTS.md` and the outreach `AGENTS.md`s                                                               |
| Local         | A `PostToolUse` hook (`.claude/hooks/serve-vocabulary-check.sh`) on the touched file, plus lint-staged on commit                            |
| CI            | `npm run check:serve-vocabulary -w packages/gp-webapp` in gp-webapp's Checks job, and `scripts/serveVocabulary.test.ts` in the Vitest suite |

Run it yourself:

```
npm run check:serve-vocabulary -w packages/gp-webapp              # whole package
npm run check:serve-vocabulary -w packages/gp-webapp -- app/serve # named files
```

### The escape hatch

Some Serve surfaces legitimately say a banned word: the past election an
incumbent won, the onboarding branch that routes an official who is also a
candidate into Win, the verbatim nonpartisan pledge. Three ways out, in order
of preference:

1. **An inline comment**, on the offending line or the line above it:
   `// serve-vocabulary-allow: how they took office, not a race they are running`
2. **A file-level comment** in the first 40 lines, when the whole file is one
   quoted document: `// serve-vocabulary-allow-file: <why>`
3. **`SEEDED_ALLOWLIST`** in `serveVocabulary.ts`, keyed `<path>:<word>`, for
   the cases where editing the product file is not what your change is about.

Every one of them takes a reason. "It was flagged" is not a reason — if the
word is right for a Serve user, say why in the comment; if it isn't, fix the
copy.

### What it deliberately does not catch

- Copy chosen by a bare `isServe ? a : b` ternary, and an unconditional string
  shown identically to both surfaces. Use a mode-keyed object and it is
  covered; the hook nudges on shared-surface edits either way.
- **A whole component in a shared directory that only ever renders for one
  surface**, because the gating lives at the CALL SITE and the strings inside
  it are unconditional. `outreach/v2/FollowUpOutstandingSection.tsx` renders
  solely behind `isServe &&` in `OutreachDetailsDrawer.tsx`, so every string
  in it is Serve copy — but nothing in the file says so, and the directory is
  shared, so the gate read it as ordinary Win-and-Serve code and passed
  "during the course of your campaign" over 1,162 clean files. Give such a
  component a `SERVE_*` copy object (see that file's `SERVE_FOLLOW_UP_COPY`)
  and rule 2 covers it. Do NOT reach for a cleverer parser that follows the
  render graph: the fix is to write the copy where the check can see it.
- `packages/gp-api` prompts and `packages/gp-sdk`. The gate is gp-webapp only.
  `SERVE_SOCIAL_VOICE` is the pattern to copy there, by hand.
- Serve words leaking into **Win** ("constituent" on a candidate's screen).
  Rarer, and the same table above is the rule.
