---
title: Contact upload files are deleted by their rows' keys, never by org prefix
status: active
decided_by: [agent]
date: 2026-10-29
code: ['#3449']
scope:
  - packages/gp-api/src/contactUploads/**
  - packages/gp-api/src/vendors/aws/services/s3.service.ts
  - packages/gp-api/src/users/services/users.service.ts
  - packages/gp-api/src/testMode/services/testMode.service.ts
  - packages/gp-api/src/testFixtures/judgeChatFixture/teardown.ts
supersedes: []
superseded_by:
---

# Contact upload files are deleted by their rows' keys, never by org prefix

## Decision

When an org is deleted, or an abandoned upload is swept, gp-api reads the
`contact_upload` rows first and deletes every version and delete marker of
each row's `fileKey` (`S3Service.deleteAllObjectVersions`, exact-key matches
only), in every environment. It never lists or deletes the bare
`<orgSlug>/` prefix. Every path that deletes a user or an organization goes
through `ContactUploadFilesService.deleteFiles` before or alongside the
database delete.

## Context

`gp-api-contact-uploads-<env>` is versioned and nothing in it expires, so
deleting data means deleting every version. Previews and local share the
dev bucket but each has its own database, and campaign org slugs are
`campaign-<autoincrement id>`, so a preview's `campaign-5` is a different org
from dev's `campaign-5` under the same prefix. Presign creates the row
before the browser can PUT, so every object in the bucket has a row and the
keys are a complete list.

## Alternatives rejected

- **Purge `<orgSlug>/` everywhere.** A preview or local deletion would wipe
  another environment's files under a colliding slug.
- **Prefix on dev and prod, keys on preview and local.** Collision-free, but
  two code paths branching on the environment for no gain, since the keys
  are already complete.

## Revisit if

Files can land in the bucket without a `contact_upload` row, or previews get
their own bucket.
