---
title: Switching organization clears client state once, at the top, by remounting the org-scoped tree
status: active
decided_by: [swain]
date: 2026-11-23
code: ['#4032']
scope:
  - packages/gp-webapp/app/shared/organization-picker.tsx
  - packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx
  - packages/gp-webapp/app/volunteer/VolunteerSidebar.tsx
  - packages/gp-webapp/app/**/hooks/**
  - packages/gp-webapp/app/**/use*.ts
supersedes: []
superseded_by:
---

# Switching organization clears client state once, at the top, by remounting the org-scoped tree

## Decision

Organization-specific client data is cleared at the highest level, once, on an
org switch — never by a feature clearing its own cache, and never by keying a
query on the org slug to be safe. `OrganizationScope`
(`app/shared/organization-picker.tsx`) keys the org-scoped subtree on the
selected slug, and both shells wrap their page content in it. A switch
therefore unmounts that content and empties the query cache, in that order.

Order is the whole mechanism. Removing a query does not unmount its consumers,
so a feature that stays mounted rebuilds its own entry and fetches it
immediately — under the header of the org the user just moved to. That is how a
row belonging to the org they left came back as a 404 (ENG-10991). Remounting
first means there is no observer left to rebuild anything.

The clear spares exactly two keys, and neither is spared because it is
org-scoped: `organizations`, which a switch resolves against (a caller that
creates an org refreshes the list and then selects the new slug, so it is the
only copy that makes that slug resolvable), and `eligibility`, which is per-user
and gates onboarding flows mid-wizard. Nothing else gets an exemption, including
per-row families keyed by a bare id.

## Context

A previous change (#4029) cleared the cache on a switch but had to exempt three
key families — the org list, eligibility, and the per-row `outreach-detail` /
`contact-notes` — plus a post-clear invalidate effect, because a query seeded
from a server `initialData` was rebuilt by its still-mounted observer and came
back counting as fresh. Every exemption was a symptom of components surviving
the switch, and the exemption list was a rule about keys standing in for a rule
about mounts: a new per-row family would have silently inherited the 404 unless
whoever added it knew the list existed.

The flows that create an org and then select it (`FollowOnFlow`,
`ElectionResultPage`, Test mode) mount outside every `OrganizationScope`, which
is what keeps a key at the shell from destroying a wizard's state mid-flow.

The cost, accepted: switching organizations on a shared page resets that page's
local state. Row lists held in `useState` come back empty and refetch instead of
surviving the switch.

## Alternatives rejected

- **Key every org-scoped query by the org slug.** Correct, but it is a rule every
  future hook must remember, the per-row hooks take a bare row id, and it leaves
  each feature responsible for its own cache hygiene — the thing this decision
  moves to one place.
- **`invalidateQueries` on a switch.** Marks data stale and refetches, and until
  the refetch lands the departed org's data is still readable. A switch taken
  from a shared path deliberately does not reload the page, so that window is
  the entire bug.
- **`removeQueries` plus a list of exempt keys.** What #4029 shipped. It needed
  the post-clear invalidate for `initialData` seeds, and a new per-row query
  hits the same 404.

## Revisit if

Remounting on a switch loses state that matters — a draft, an in-progress form,
a scroll position a user needs across a switch — badly enough that preserving it
is worth the complexity of keying org-scoped data instead.
