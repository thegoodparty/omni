---
title: Census tract names are stored once, and filled after the civic panel summary read
status: active
decided_by: [agent]
date: 2026-10-23
code: ['#3175']
scope:
  - packages/gp-api/src/contacts/services/censusTractName.service.ts
  - packages/gp-api/src/contacts/services/civicPanelSummary.service.ts
  - packages/gp-api/src/contacts/utils/censusTractName.util.ts
  - packages/gp-api/src/vendors/geoapify/services/geoapifyReverseGeocode.service.ts
  - packages/gp-api/prisma/schema/censusTractName.prisma
supersedes:
  - 2026-10-22-census-tract-names-stored-once.md
superseded_by:
---

# Census tract names are stored once, and filled after the civic panel summary read

## Decision

Each census tract is named once, ever, from a Geoapify reverse geocode of
its residents' mean point (neighbourhood, suburb, quarter, district), else
the street most of them live on, else its number, and stored in
`census_tract_name` keyed by GEOID. The naming starts after the response of
a `GET /v1/contacts/civic-panel` read that finds an unnamed tract in the
panel's composition. The response never waits for Geoapify, a row claims a
tract before the call, and a tract already named or being named is never
geocoded again. Labels are made distinct per district at read time.

## Context

The earlier record named tracts only after a build plan write, never on a
read. The build plan was deleted with the managed civic panel, so no write
is left that sees the panel's tracts. Everything else in that record holds.

## Alternatives rejected

- Naming on the managed approval: a new panel has no members, so no
  composition and no tracts to name.
- Naming inside the read: puts Geoapify's latency on the page.
- Geocoding on every read, or caching in memory: rejected in the earlier
  record; tract names do not change.

## Revisit if

The warehouse publishes tract names or outlines, or Geoapify's terms on
storing results change.
