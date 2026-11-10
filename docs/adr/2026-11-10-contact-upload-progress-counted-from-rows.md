---
title: A processing contact upload's progress is counted from its rows, not written by the job
status: active
decided_by: [agent]
date: 2026-11-10
code: ['#PR']
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/contracts/src/contactUploads/**
supersedes: []
superseded_by:
---

# A processing contact upload's progress is counted from its rows, not written by the job

## Decision

While an upload is `processing`, `GET /v1/contact-uploads` and
`GET /v1/contact-uploads/:id` return `progress` (`added`, `needsInput`), read
on each request with one grouped count of the upload's `contact_upload_match`
rows by outcome. The job still writes the upload's counts only at finalize.
Nothing new is stored.

## Context

The email flow imports contacts in place and shows how many have been added
while matching runs. The upload's count columns stay 0 until the job
finishes, because finalize recomputes them from the rows so a retried attempt
cannot double-count (`countOutcomes`). Rows are committed chunk by chunk, so
they already say how far the job has got, and `(upload_id, outcome,
row_index)` is indexed.

## Alternatives rejected

- **The job bumps the counts after each chunk.** A retried attempt re-works
  rows and would double-count, the reason counts are never incremented.
- **The job recomputes the counts after each chunk.** It moves the count
  columns off "what finished" mid-run, and the Contacts pages read them as
  final.
- **No number, only "Adding your contacts…".** The rows make the number
  cheap, and a bare spinner over a 100,000-row file says nothing.

## Revisit if

Uploads grow well past 100,000 rows, or something polls progress far more
often than every few seconds, so the grouped count stops being cheap.
