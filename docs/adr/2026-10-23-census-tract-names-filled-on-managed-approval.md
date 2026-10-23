---
title: Census tract names are filled when a managed civic panel is approved, and after a summary read
status: active
decided_by: [bryclevgp]
date: 2026-10-23
code: ['#3196']
scope:
  - packages/gp-api/src/contacts/services/censusTractName.service.ts
  - packages/gp-api/src/contacts/services/civicPanelSummary.service.ts
  - packages/gp-api/src/contacts/services/managedCivicPanel.service.ts
  - packages/gp-api/src/contacts/utils/censusTractName.util.ts
  - packages/gp-api/src/vendors/geoapify/services/geoapifyReverseGeocode.service.ts
  - packages/gp-api/prisma/schema/censusTractName.prisma
supersedes:
  - 2026-10-23-census-tract-names-filled-after-a-read.md
superseded_by:
---

# Census tract names are filled when a managed civic panel is approved, and after a summary read

## Decision

Each census tract is named once, ever, from a Geoapify reverse geocode of
its residents' mean point, else its top street, else its number, and stored
in `census_tract_name` keyed by GEOID. Naming starts in the background when
an office approves its managed civic panel (`POST
/v1/contacts/civic-panel/managed`, first approval or re-approval after a
stop), for every tract in the district's census tract list. A
`GET /v1/contacts/civic-panel` read that finds an unnamed tract still names
it after its response, as a backstop. Neither the approval nor the read
waits for Geoapify or fails on it.

## Context

Naming only after the first summary read meant the official's first look at
the panel page showed raw tract numbers. The district's tract list comes
from the census (adults per tract), not the panel's members, so it is known
at approval, before anyone has joined.

## Alternatives rejected

- Naming only after a read: the first page view shows numbers.
- Naming inside the approval request: puts Geoapify's latency and failures
  on the approval.
- Naming only the tracts with members: a new panel has none, and the page
  shows every tract in the district.

## Revisit if

The warehouse publishes tract names or outlines, or Geoapify's terms on
storing results change.
