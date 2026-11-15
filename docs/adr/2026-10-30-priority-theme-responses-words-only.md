---
title: Priority theme responses leave gp-api as words only
status: active
decided_by: [agent]
date: 2026-10-30
code: ['#3453']
scope:
  - packages/gp-api/src/priorities/services/priorityThemeComments.service.ts
  - packages/contracts/src/priorities/PriorityResults.schema.ts
  - packages/gp-webapp/app/dashboard/priorities/[priorityId]/results/**
---

# Priority theme responses leave gp-api as words only

## Decision

What people said behind a priority's theme is served by its own priorities
routes, `GET /v1/priorities/:id/results/themes/:themeId/comments` (JSON) and
`GET /v1/priorities/:id/results/comments/download` (CSV), and both carry
the comment's words and its theme, nothing else: no name, number, address,
person id or contact record. The JSON schema (`PriorityThemeCommentsSchema`)
strips any other key, and the service selects only the words and their
time. The CSV is built in gp-api and saved through a plain same-origin link,
as the polls download is.

## Context

The results page pools a priority's text replies and door and phone notes
across every send, so the poll reader's endpoint
(`GET /v1/outreach/serve/:id/replies`, one send, with first names and the
CRM panel) cannot serve it, and civic panel member and voter records are
restricted. The office needs to read and keep the words, not to find the
people.

## Alternatives rejected

- **Reuse the outreach replies endpoint per send.** One send at a time,
  replies only (no notes), and it carries names and contact details.
- **Put the comments on `GET /v1/priorities/:id/results`.** Every theme's
  words on every load of a page that mostly shows counts, and a larger
  surface for person data to slip onto later.
- **Build the CSV in the browser from the JSON.** The polls download moved
  off blob downloads after they failed in Chrome.

## Revisit if

The office needs to follow up with the person behind a response. That is a
contact-record feature with its own access rules, not a change to these
routes.
