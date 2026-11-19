---
title: Undoing a contact upload deletes its file, its upload row and its match rows
status: active
decided_by: [agent]
date: 2026-11-05
code: ['#3613']
scope:
  - packages/gp-api/src/contactUploads/**
supersedes: []
superseded_by:
---

# Undoing a contact upload deletes its file, its upload row and its match rows

## Decision

`DELETE /v1/contact-uploads/:id` deletes every version of the stored CSV,
then the `contact_upload` row, which cascades to its `contact_upload_match`
rows. Nothing marks an upload as undone. The `gp_api_contact_overlay` dbt
view reads only match rows, so the upload's values and the people only it
added leave every people read with no change to the view. A later upload
that matched one of those people keeps its rows. Notes and activity on a
removed person stay on its id, as with Change match.

## Context

A user asked to drop a file of their own people. The overlay is a live view
in gp-data-platform over gp-api's Postgres through Lakehouse Federation, and
the matcher reads the org's earlier match rows to recognize people again.
Both already treat a row as present or absent, nothing in between.

## Alternatives rejected

- **An `undone` status on the upload.** The overlay view would have to join
  and filter on it (a change in another repo, deployed in step with this
  one), the matcher would need the same filter, and the CSV and rows of
  people the user asked us to drop would stay stored.
- **Deleting the match rows but keeping the upload in history.** History
  would list an import that supplied nothing, and the stored file would
  outlive its rows.

## Revisit if

Users need to see what they undid, or redo an undo. That needs a record of
the undo, not the deleted rows.
