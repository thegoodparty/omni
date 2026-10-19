---
title: Race and ethnicity count in civic panel weighting, steering and under-heard groups
status: active
decided_by: [bryclevgp]
date: 2026-10-19
code: ['#2916', '#2920']
scope:
  - packages/gp-api/src/priorities/util/censusWeighting.util.ts
  - packages/gp-api/src/priorities/util/priorityReadStatus.util.ts
  - packages/gp-api/src/contacts/utils/civicPanelSteering.util.ts
  - packages/gp-api/src/chats/general/chief-of-staff/services/chiefOfStaffPrompt.ts
  - packages/gp-api/src/chats/general/priority-flow/**
supersedes: []
superseded_by:
---

# Race and ethnicity count in civic panel weighting, steering and under-heard groups

## Decision

Race and ethnicity join age, tenure, neighborhood and gender in every civic
panel use: the comparison bars, weighting a priority's answers to the
census, naming the groups an official should hear from more, and steering
who the panel build plan invites.

## Context

On 2026-10-14 Bryan kept race out of targeting and weighting until counsel
weighed in. Weighting (#2916) and steering (#2920) shipped without it, and
the Chief of Staff and priority prompts were told never to steer by race.
Race was shown only on the comparison bars.

## Reasoning

A panel that is meant to look like the district has to be measured, and
corrected, on the same dimensions people use to judge whether it does. Bryan
and Samuel (the team's statistician) made the call together and judged that
this use does not need counsel review.

## Alternatives rejected

- **Keep race display-only until counsel reviews it.** Rejected: Bryan and
  Samuel decided counsel review isn't needed for this use.
- **Weight on race but never steer or name groups by it.** Rejected: Bryan
  chose all uses.

## In their words

"Yes, and all of the above." (agent session with @bryclevgp, 2026-10-19, on
which uses to build: showing it, weighting, naming a group to hear from, and
steering who gets invited)

"Counsel hasn't cleared it, I have along with Samuel. We don't need counsel
review for this." (agent session with @bryclevgp, 2026-10-19)

## Revisit if

The statistician finds the voter file's modeled ethnicity too noisy to weight
or steer on.
