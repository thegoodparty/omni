---
title: The analytics product map takes its areas from gp-api's productMap.ts
status: active
decided_by: [datawithtristan]
date: 2026-11-19
code: ['#3948']
scope:
  - packages/runbooks/surfaces/product-map/**
  - packages/gp-api/src/chats/general/product-knowledge/productMap.ts
supersedes: []
superseded_by:
---

# The analytics product map takes its areas from gp-api's productMap.ts

## Decision

The product map's list of areas is read at build time from
`productMap.ts`, the area list the in-product assistants answer from. Areas
someone has drawn keep their hand-drawn steps; every other area appears as an
"events only" list. The read is a regex in the dependency-free `build.py`, and
a runbooks test counts the areas a second way so a layout change in
`productMap.ts` fails CI instead of emptying the map.

## Context

The map's areas were hand-written in `map.js` and nothing kept them current.
By 2026-11-19 Serve showed 4 areas against 11 in the app, and the two busiest
Serve areas (Community Issues, Briefing Assistant) were missing.
`productMap.ts` is already kept in step with the nav by a CI check, and
releases update it, so it is the one list that tracks the product.

## Alternatives rejected

- Keep adding areas to `map.js` by hand: it drifted for a month unnoticed, and
  would drift again with the next release.
- Export the areas from gp-api as JSON with a TypeScript script: the republish
  routine runs `build.py` with a bare interpreter and no `npm ci`, so the build
  cannot run gp-api code.

## Revisit if

`productMap.ts` stops being kept in step with the nav, or moves to a format
(JSON, generated) that `build.py` can read without a regex.
