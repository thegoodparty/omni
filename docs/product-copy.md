# Product copy rules

Every string a candidate reads is product. This file is the standard for
writing it: UI copy in `gp-webapp`, `gp-admin`, `prototypes`, and
`candidate-sites`, and any user-facing text our AI agents generate.

Our users are first-time candidates and small-town elected officials doing
this at night, on a phone, between a job and a family. They are not reading.
They are scanning, deciding, and moving. Copy that makes them stop and parse
is a bug.

The voter outreach flows and onboarding are the reference implementations.
When you need a model, read those and match them.

## The nine rules

### 1. A step title is a question the user can answer

Every flow step asks one plain question in the user's own words. Not a label,
not a feature name, not a description of the screen.

| Write this                      | Not this            |
| ------------------------------- | ------------------- |
| Will you be walking or driving? | How will you knock? |
| Who do you want to reach?       | Audience selection  |
| What do you want to say?        | Message composition |
| When should it go out?          | Scheduling options  |

Source of truth for the pattern:
`packages/gp-webapp/app/dashboard/outreach/v2/robocall`,
`sms`, and `social` step titles, and
`packages/gp-webapp/app/onboarding/components/onboardingConfig.ts`.

### 2. One sentence under the title. Twenty words or fewer

The caption says why we are asking or what to do next. That is all it does.
If you need a second sentence, the step is asking for too much and should be
split.

Before (52 words, three sentences, all about our internals):

> This builds the route and locks the turf. The list of doors is frozen so
> everyone works from the same plan, and the directions are bought for the
> travel mode you pick. You only do this once per turf.

After (15 words):

> This helps us draw the most efficient route for you based on how you're
> getting there.

### 3. Never explain the system

Users do not need to know what the system does. They need to know what
changes for them. Cut anything about records, jobs, freezing, dispatching,
provisioning, syncing, artifacts, or why our architecture requires a step.

If a mechanic genuinely affects their money, their time, or their data,
say the consequence in one clause and stop. "You are only charged for the
calls we actually place" is the consequence. A paragraph about how holds and
releases work is not.

### 4. Use their words, not ours

Candidates say voters, doors, calls, texts, yard signs, turnout. They do not
say audience segment, contact record, dispatch, campaign entity, outreach
artifact, or persuasion universe. Internal names are for code, not screens.

### 5. Say it out loud first

If you would not say the sentence to a candidate on the phone, do not ship
it. Contractions are good. Second person is good. "You're", "we'll", "let's".
The onboarding welcome step is the tone: "All we need to know is what office
you're running for. We'll take it from there."

### 6. Buttons name the thing that happens

Verb plus object, in the user's frame. "Start verification", "Save and exit",
"Add a door", "Later". Never "Submit". Never "Continue" when something
specific and irreversible is about to happen. Never a button that requires
the caption to explain it.

### 7. Reuse the phrase we already use

The same question should read the same way in every channel. Before writing
a new string, grep for the one that exists. Consistency beats freshness, and
a new synonym for an old idea is a bug, not a flourish.

Copy that is shared lives in constants, not inline: see
`outreach/v2/*Purposes.ts`, `outreach/v2/channelMeta.tsx`,
`outreach/constants.tsx`, and `onboarding/components/onboardingConfig.ts`.

### 8. Errors and empty states: what happened, then what to do

Two clauses, in that order, no apology paragraph. "Voter data is not
available for your office. Email help@goodparty.org so we can update your
district." Never blame the user, never bury the action, never make them
guess whether to wait or act.

### 9. Never inflate

No claims we cannot support, no invented numbers, no urgency we did not
earn. Nonpartisan, factual, plain. If a projection is a projection, call it
one.

## Mechanics

- Sentence case for every heading, label, and button. No title case.
- No em dashes. Use a period or a comma.
- No exclamation points. No emoji.
- No bold or italic inside a caption for emphasis.
- Numerals for numbers. "5 minutes", not "five minutes".
- Titles: 12 words or fewer. Captions: 20 words or fewer.

## Words we do not use

seamlessly, effortlessly, powerful, robust, leverage, supercharge,
elevate, streamline, empower, curated, cutting-edge, best-in-class,
game-changing, dive in, simply, just, please note that, in order to,
utilize, comprehensive, holistic, granular, at your fingertips.

Also cut the setup phrase that delays the point: "This feature allows you
to", "Here you can", "We're excited to". Start with the point.

## Before you ship a string

1. Is the title a question the user can answer in their own words?
2. Is the caption one sentence, 20 words or fewer?
3. Does anything in it describe how the system works? Cut it.
4. Would you say it out loud on the phone?
5. Does the phrase already exist somewhere in the repo? Use that one.
6. Read it once more and delete the words doing no work.

## AI-generated copy

The same rules apply to text an agent writes for a candidate: outreach
drafts, briefings, plan sections, chat replies. When you write or edit an
agent instruction in `packages/runbooks/experiments/*/instruction.md` or a
prompt in `packages/gp-api/src/`, put these constraints in the prompt.
Sentence limits and a banned-words list in the instruction do more than any
amount of editing after the fact.
