---
title: Contact upload files go browser to S3, and only the queue job reads them
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#TBD']
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/gp-api/prisma/schema/contactUpload.prisma
  - packages/gp-api/deploy/components/contact-uploads-bucket.ts
  - packages/gp-webapp/app/dashboard/contacts/crm/import/**
supersedes: [2026-10-29-contact-upload-files-go-browser-to-s3.md]
superseded_by:
---

# Contact upload files go browser to S3, and only the queue job reads them

## Decision

The Import contacts file never passes through the webapp or gp-api, and no
request reads it. `POST /v1/contact-uploads/presign` takes the upload's
name, mapping, consent and size, creates the `contact_upload` row as
`awaiting_file`, and signs a PUT to `<orgSlug>/<uploadId>.csv` in
`CONTACT_UPLOADS_BUCKET` for the exact size (at most 25 MB) and `text/csv`.
The browser PUTs the file, then `POST /v1/contact-uploads/:id/uploaded`
HEADs the object, sets `processing` and queues `CONTACT_UPLOAD_PROCESS`.
That one job streams the file into rows, 5,000 per `createMany` with
`skipDuplicates` and no wrapping transaction, records `ingestedAt` and
`rowCount`, then matches in chunks. A file that cannot import fails the
upload with a `failureReason`, not the request.

## Context

The webapp's `/api` proxy on Vercel caps request bodies at 4.5 MB, and the
screen promises 25 MB, so the file has to go straight to S3. The first
version then read the file back inside the create request and inserted the
upload and every row in one transaction: a 100,000-row file held the request
for about 48 seconds and one transaction for about 35.

## Alternatives rejected

- Lower the limit to 4.5 MB: a 100,000-row list is well over it.
- Presigned POST with a `content-length-range` policy: also caps the size,
  but signing the exact length on a PUT does the same with a plain body.
- Keep parsing in the request but insert in separate statements: shorter
  locks, but the request still grows with the file.
- A separate ingest job ahead of the match job: two status machines for one
  upload, when one job can skip a phase already done.

## Revisit if

Files need to go past 25 MB, which would need multipart upload, or abandoned
`awaiting_file` uploads pile up enough to need a cleanup sweep.
