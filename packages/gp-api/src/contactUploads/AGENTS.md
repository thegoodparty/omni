# Import contacts (contactUploads)

A Serve office or a Win campaign uploads a CSV of its own people; every row
is matched to a person we already hold or becomes a new person. Postgres is
the system of record (`contact_upload`, `contact_upload_match`,
`prisma/schema/contactUpload.prisma`); Databricks reads those rows live
through federation and folds them into every people read for the org (the
read seam lives in `src/peopleDb/`, not here). Every route 404s unless
`serve-import-contacts` (`SERVE_IMPORT_CONTACTS_FLAG`) is on for the org's
owner, the one flag for Serve and Win. A Win campaign also needs Pro
(`ContactsService.assertProAccess`, the contact-detail rule): without it the
routes 403 with `PRO_FEATURE_REQUIRED_MESSAGE`
(`docs/adr/2026-10-29-import-contacts-covers-win-pro-campaigns.md`). A Win
campaign matches against and reads `gp_api_voters`; an imported person reads
NULL in every voter-only column. Contracts: `contracts/src/contactUploads/`.

## Routes

| Method and path                                 | What                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /v1/contact-uploads/presign`              | Name, file name, consent, mapping, `byteSize` (max 25 MB); creates the upload, returns a PUT URL |
| `POST /v1/contact-uploads/:id/uploaded`         | The PUT landed: HEAD the object, `processing`, queue the job                                     |
| `GET /v1/contact-uploads`                       | Upload history, newest first, without `awaiting_file` uploads                                    |
| `GET /v1/contact-uploads/:id`                   | One upload with counts                                                                           |
| `GET /v1/contact-uploads/:id/rows`              | Rows by outcome, keyset-paged on `rowIndex`, `ILIKE` search                                      |
| `PUT /v1/contact-uploads/:id/rows/:rowId/match` | `{ personId }`, `{ newPerson }` or `{ skip }`; returns the upload                                |
| `POST /v1/contact-uploads/:id/accept-suggested` | Accept every lone name-only suggestion, one transaction                                          |
| `POST /v1/contact-uploads/:id/retry`            | A `failed` upload back to `processing`, the job queued again                                     |
| `GET /v1/contacts/:personId/sources`            | Per-field "Came from", the person's upload rows, `hasActivity`                                   |

The person feed (`GET /v1/contact-engagement/:id/activities`) reads this
person's rows as `CONTACT_IMPORT` items (`ContactUploadMatchService.findForActivityFeed`),
for Serve and Win alike.
`isFirstImport` marks the person's earliest row by feed date (`resolvedAt` for
manual rows, else the upload's `createdAt`): the upload that brought them in.

## Flow

1. **Upload** (`services/contactUploads.service.ts`): the browser sends the
   file straight to `CONTACT_UPLOADS_BUCKET`, never through gp-api, because
   the webapp's `/api` proxy on Vercel caps bodies at 4.5 MB. `presign`
   creates the `contact_upload` row (`awaiting_file`, `rowCount` null) and
   signs a PUT to `<orgSlug>/<uploadId>.csv` for exactly the declared size
   and `text/csv`, valid 15 minutes (`S3Service.getSignedUrlForSizedUpload`).
   Then `POST /v1/contact-uploads/:id/uploaded` HEADs the object (400 if it
   is missing or over 25 MB), flips the upload to `processing` and enqueues
   `CONTACT_UPLOAD_PROCESS` (`MessageGroupId` per org, so an org's uploads
   process in order). Neither route reads the file, so request time does
   not grow with it. Only the confirm whose `updateMany` moves the upload
   out of `awaiting_file` enqueues, and only it can mark the upload `failed`
   if the enqueue throws; a repeat or overlapping confirm returns the upload
   as it is. Both routes 503 when the bucket is unset, so importing locally
   needs the dev bucket and AWS access. Bucket CORS:
   `deploy/components/contact-uploads-bucket.ts`.
2. **Read the file** (`services/contactUploadProcessJob.service.ts`), the
   first phase of the job, while `ingestedAt` is null: streams the object
   from S3 (`S3Service.getFileStream`), parses by the user's chosen headers
   (`readContactUploadCsv`, `util/contactUploadCsv.util.ts`), normalizes
   (email lowercased and validated, phones to `(xxx) xxx-xxxx`, ZIP to 5
   digits) and inserts rows 5,000 per `createMany({ skipDuplicates: true })`,
   each its own statement with no wrapping transaction. `(uploadId, rowIndex)`
   is unique, so a redelivery re-reads the file and skips what landed. Then
   it sets `ingestedAt` and `rowCount` and falls through to matching in the
   same delivery. A row without first and last name is `invalid`. A file that
   can never import (a mapped column missing, over 100,000 rows, no rows,
   unreadable, or gone from the bucket) throws `ContactUploadFileError`: the
   upload goes `failed` on the first delivery with the error's message as
   `failureReason`, which the UI shows, and `failureKind` `file`, and its
   partial rows are deleted. Every other failure (the last delivery failing,
   or the job never queued) is `failureKind` `transient`; the UI offers Try
   again only for those, since retrying a bad file fails the same way.
3. **Match**, the second phase of the same job, one chunk of
   up to 4,000 pending rows per delivery, cut shorter when the rows' JSON
   would pass 800,000 characters (`fitContactUploadMatchRows`): Databricks
   rejects a bound parameter over 1,048,576. While pending rows remain, the
   delivery queues the same message again (same `MessageGroupId`,
   deduplicated on the next pending `rowIndex`) before acking, so no
   delivery outlives the 5-minute visibility timeout. Per chunk, in order: duplicates within the chunk, the org's earlier
   rows in Postgres (email, then phone + last name, then name + address,
   then for a name-only row a name-only row the user resolved by hand,
   when every such row with that name points to one person),
   then one Databricks statement per chunk
   (`peopleDb/databricks/contactUploadMatchSql.util.ts`, through
   `VoterQueryService.matchContactUploadRows`). The outcome table is
   `decideFromCandidates` (`util/contactUploadMatching.util.ts`). New people
   get a uuid v7. Each chunk commits on its own and only `pending` rows are
   worked, so a redelivery resumes. A row landing on someone an earlier
   upload already gave values gets `changedFields`.
   Counts are never incremented: finalize, a review PUT and accept-suggested
   each recompute all of them from one grouped count over the upload's rows
   (`countOutcomes`, `util/contactUploadCounts.util.ts`), so a duplicate
   delivery cannot double-count. Updated is a row with `changedFields`;
   unchanged is a `prior_upload` row without.
4. **Review**: `needs_input` rows wait until the user picks. Candidate
   details are read from Databricks by id (`VoterQueryService.findPeople`
   with an `id` filter) for the page being shown, never stored.

## Things that look like bugs but aren't

- **The handler reads `ApproximateReceiveCount`.** The consumer asks SQS for
  it (`queueConsumer.module.ts`). On the delivery that reaches the queue's
  `maxReceiveCount` (3, `CONTACT_UPLOAD_PROCESS_MAX_RECEIVES`) a failure marks
  the upload `failed` and acks, instead of leaving it `processing` behind a
  DLQ message.
- **`isNewPerson` is copied, not recomputed.** A row that reuses an earlier
  row's person takes that row's `isNewPerson`, because the overlay view ANDs
  it across a person's rows.
- **Change match does not move history.** Notes, statuses and interactions
  stay on the old person id; `hasActivity` is there so the UI can warn.
- **Uploads never clear opt-outs, blocks or unsubscribes.** A file cannot
  reopen anyone who opted out.
- **No names, emails or phones in logs or analytics.** Ids and counts only.

## Not built here

- Cleaning up abandoned uploads: one left `awaiting_file` (the browser
  closed before its PUT or confirm) stays in Postgres, and maybe in the
  bucket, forever. Upload history and every read route hide `awaiting_file`
  uploads, so the user never sees it, but nothing deletes them yet.

- Deleting an org's files from the bucket: Postgres rows cascade with the
  org, but no org deletion hook exists to clear `<orgSlug>/` in S3. The
  bucket is versioned and nothing expires, so a deletion has to remove every
  version and delete marker under the prefix, not just the current objects.

## Tests

`tests/contactUploads.routes.test.ts` drives everything through
`useTestService()` (a Serve org, plus a `Win campaigns` block for Pro,
non-Pro and flag off), standing in for the bucket by spying
`S3Service.getSignedUrlForSizedUpload`, `headObject` and `getFileStream`,
spying
`VoterQueryService.matchContactUploadRows` and
`findPeople` for Databricks and calling `handleQueuedProcess` directly (the
consumer does not run in tests). Pure logic: `util/*.test.ts`; the statement:
`peopleDb/databricks/contactUploadMatchSql.util.test.ts`.
