---
title: Census tract names are worked out once and stored in gp-api's Postgres
status: active
decided_by: [bryclevgp]
date: 2026-10-22
code: ['#3127']
scope:
  - packages/gp-api/src/contacts/services/censusTractName.service.ts
  - packages/gp-api/src/contacts/utils/censusTractName.util.ts
  - packages/gp-api/src/vendors/geoapify/services/geoapifyReverseGeocode.service.ts
  - packages/gp-api/prisma/schema/censusTractName.prisma
supersedes: []
superseded_by:
---

# Census tract names are worked out once and stored in gp-api's Postgres

## Decision

The civic panel names each census tract from a Geoapify reverse geocode of
its residents' mean point (the first of neighbourhood, suburb, quarter,
district), else the street most of them live on, else its number. The name
is stored in `census_tract_name`, keyed by the 11-digit GEOID, with its
source, and kept forever: tract names do not change, so Geoapify is called
at most once per tract, and only after a plan write's response, never on a
read. A row is written before the call to claim the tract and removed if the
call fails. Labels are made distinct per district at read time, so the
stored name stays the tract's own.

## Context

The seats chart and Furthest behind rows showed raw tract ids like "Tract
25.03", which no official recognizes. There are no tract outlines in the
warehouse yet, and no neighborhood names. Geoapify is already a paid vendor
with a key, metrics and mocks (door knocking); a reverse geocode is one
credit. An OpenStreetMap spot-check of six Asheville points gave a
neighborhood for four, so about half of tracts get one and the rest fall
back to a street.

## Alternatives rejected

- Geocoding on every read, or caching in memory: pays per page view and per
  deploy, for an answer that never changes.
- Keying the name per district: a tract's name is the same in every
  district, and per-district rows would pay again for each one.
- Storing the de-duplicated label: whether a name collides depends on the
  district's other tracts, so it is worked out per read instead.
- A warehouse table of tract names: nothing publishes one today; when tract
  outlines land (https://app.clickup.com/t/17tnw2b6k0u) this is the place
  to revisit.

## Revisit if

The warehouse publishes tract names or outlines, or Geoapify's terms on
storing results change.
