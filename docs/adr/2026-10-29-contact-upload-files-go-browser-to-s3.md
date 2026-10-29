---
title: Contact upload CSVs go from the browser straight to S3 by presigned PUT
status: active
decided_by: [agent]
date: 2026-10-29
code: ['#3403']
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/gp-api/deploy/components/contact-uploads-bucket.ts
  - packages/gp-webapp/app/dashboard/contacts/crm/import/**
supersedes: []
superseded_by:
---

# Contact upload CSVs go from the browser straight to S3 by presigned PUT

## Decision

The Import contacts file never passes through the webapp or gp-api.
`POST /v1/contact-uploads/presign` mints the upload id and signs a PUT to
`<orgSlug>/<uploadId>.csv` in `CONTACT_UPLOADS_BUCKET` for the exact declared
size (at most 25 MB) and `text/csv`. The browser PUTs the file, then
`POST /v1/contact-uploads` names the id and gp-api reads the object back. With
the bucket unset, both routes return 503.

## Context

The webapp's `/api` proxy on Vercel caps request bodies at 4.5 MB, and the
screen promises 25 MB. A 5.5 MB file got a 413 in the dev test.

## Alternatives rejected

- Lower the limit to 4.5 MB: a 100,000-row list is well over it.
- Presigned POST with a `content-length-range` policy: also caps the size,
  but signing the exact length on a PUT does the same with a plain body.
- A gp-api sink for laptops without a bucket, like constituent feedback's
  mock upload: one more route and temp-file handling for a case
  `.env.example` already avoids by setting the dev bucket.

## Revisit if

Uploads move off Vercel's proxy, or files need to go past 25 MB, which would
need multipart upload.
