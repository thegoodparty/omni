---
title: Contact upload matching grades first names with Databricks built-ins and a vendored nickname list
status: active
decided_by: [swain]
date: 2026-11-03
code: ['#PR_NUMBER']
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/gp-api/src/peopleDb/databricks/contactUploadMatchSql.util.ts
supersedes: []
superseded_by:
---

# Contact upload matching grades first names with Databricks built-ins and a vendored nickname list

## Decision

Import contacts matches a row against the district's people with the same
last name (letters only) and a compatible first name, graded exact, alias,
prefix or typo. The grading is one Databricks statement using built-ins only
(`array_contains`, `startswith`, `levenshtein`). Aliases come from a nickname
list vendored into gp-api (`contactUploads/data/nicknames.csv`, from
carltonnorthern/nicknames, Apache 2.0): gp-api expands each row's first name
and sends the set with the row. Scoring is point constants in TypeScript
(`decideFromCandidates`). A row auto-matches only when one candidate's first
name is closer than a typo, its phone or address agrees, and it outscores
every other candidate. A name alone never matches.

## Context

Matching on exact first and last name made a new person whenever the file
said John and the voter file said Johnathan, even with the same phone (raised
on #3539). The match runs per chunk of up to 4,000 rows inside a queue job
with a 5-minute visibility timeout, so it has to stay one statement per chunk.

## Alternatives rejected

- **A Databricks UDF (Jaro-Winkler or similar).** Python UDFs run per pair
  and are slow at district scale, and a UDF has to be created and granted in
  the workspace from outside this repo.
- **The data team's Splink pipeline (gp-data-platform).** A cross-repo
  dependency and grants; this keeps matching in one repo.
- **A nickname table in Databricks.** The same list read from a table needs a
  dbt model and a grant; sent with the row it stays in one repo.

## Revisit if

Exact, alias, prefix and typo grades leave too many rows in Needs input, or
the warehouse gains a fast built-in for name similarity.
