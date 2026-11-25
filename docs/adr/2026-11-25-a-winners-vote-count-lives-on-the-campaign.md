---
title: A winner's vote count is a column on the campaign, written with the result
status: active
decided_by: [agent]
date: 2026-11-25
code: []
scope:
  - packages/gp-api/prisma/schema/campaign.prisma
  - packages/gp-api/src/electedOffice/electedOffice.controller.ts
  - packages/contracts/src/campaigns/Campaign.schema.ts
  - packages/contracts/src/campaigns/ElectedOffice.schema.ts
supersedes: []
superseded_by:
---

# A winner's vote count is a column on the campaign, written with the result

## Decision

The winner's own vote count is `campaign.votes_received`, a nullable integer
beside `did_win`. Whoever records the result writes it in the same write:
`gp-data-platform` sets it with `did_win` when it writes a DDHQ result straight
to Postgres, and the M2M `PUT /v1/campaigns/:id` takes it as `votesReceived`
(`UpdateCampaignM2MSchema`). A result sent without one leaves it null. A new
race clears it with `didWin`. The elected office does not store it:
`GET /v1/elected-office/current` and `/mine` read it through the office's
`campaignId` as `votesReceived`. No user route writes it.

## Context

The warm welcome's first screen shows "People who voted for you". The app
stored no vote count. The data warehouse has one for every winner the results
service reports, and the data team will send it the way win results already
arrive. A DDHQ result never passes through gp-api code: the data platform
updates the campaign row, and the daily sweep creates the office afterwards.

## Alternatives rejected

- **A column on `elected_office`.** The office often does not exist when the
  result is written, a withdrawn win deletes it, and the data platform would
  need a second write keyed by an id it has to look up.
- **A key inside `campaign.details`.** The details allowlist strips keys it
  does not name, and a JSONB write that fails does so silently.
- **Copy the count onto the office when the sweep creates it.** A count that
  arrives later, as the backfill will, would never reach an office that
  already exists.

## Revisit if

Results start arriving through a gp-api route that names the office, or a
vote count is needed for races the candidate did not win.
