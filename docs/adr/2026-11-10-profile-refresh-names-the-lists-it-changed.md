---
title: A /people page refresh names the site-wide lists the write changed
status: active
decided_by: [agent]
date: 2026-11-10
code: ['#3709']
scope:
  - packages/gp-api/src/personProfiles/services/marketing-revalidation.service.ts
---

# A /people page refresh names the site-wide lists the write changed

## Decision

Every call gp-api makes to gp-marketing's `POST /api/revalidate-person` sends
`{ personId, listings }`. `listings` names the site-wide lists the write moved
the person into or out of: `published` and `unlisted`. An edit sends `[]`.
gp-marketing always busts the person's own tag, and busts a list's tag only
when the list is named. `revalidatePerson` takes `listings` as a required
argument, so every caller has to decide.

## Context

Every profile, location and position page on gp-marketing reads both lists, to
decide whose photo a card may show. The route used to bust the removals list on
every call, so one candidate's edit re-rendered every one of those pages, in
the foreground, on its next request. That was about 20% of `/people` requests
from Nov 3 to 5, 2026. The route cannot tell from a person id which list
changed; only the writer knows.

A caller that sends no `listings` (gp-api before this change) gets both lists
busted, as before, so the two repos can deploy in either order.

## Alternatives rejected

- **Bust both lists on every call.** Correct, but it is the cost being removed.
- **Send the kind of write (`publish`, `edit`, `takedown`).** It ties the
  receiver to gp-api's list of writes. The lists are what the receiver acts
  on, and a new write maps onto them without a gp-marketing change.
- **Have gp-marketing diff the lists itself.** It would need the previous list
  across serverless instances, and would race with concurrent writes.

## Revisit if

A page starts reading another site-wide list. Add it to `PersonListing` here
and to `LISTING_TAGS` in the route together.
