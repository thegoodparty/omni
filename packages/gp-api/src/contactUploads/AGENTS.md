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

| Method and path                                 | What                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/contact-uploads/presign`              | Name, file name, consent, mapping, `byteSize` (max 25 MB); creates the upload, returns a PUT URL                    |
| `POST /v1/contact-uploads/:id/uploaded`         | The PUT landed: HEAD the object, `processing`, queue the job                                                        |
| `GET /v1/contact-uploads`                       | The Imports list, newest first, without `awaiting_file` uploads                                                     |
| `GET /v1/contact-uploads/:id`                   | One upload with counts; while `processing`, `progress` (rows added and needing input so far), else null             |
| `GET /v1/contact-uploads/:id/rows`              | Rows by outcome, keyset-paged on `rowIndex`, `ILIKE` search; `inVoterFile` is `!isNewPerson`; or one row by `rowId` |
| `PUT /v1/contact-uploads/:id/rows/:rowId/match` | `{ personId }`, `{ newPerson }` or `{ skip }`; returns the upload                                                   |
| `POST /v1/contact-uploads/:id/accept-suggested` | Accept every lone name-only suggestion, one transaction                                                             |
| `POST /v1/contact-uploads/:id/retry`            | A `failed` upload back to `processing`, the job queued again                                                        |
| `GET /v1/contact-uploads/:id/undo-preview`      | People only this upload added, and whether any of them `hasActivity`; 409 while `processing`                        |
| `DELETE /v1/contact-uploads/:id`                | Undo: deletes the file, then the upload and its rows; 204, 409 while `processing`                                   |
| `GET /v1/contacts/:personId/sources`            | Per-field "Came from", the person's upload rows, `hasActivity`                                                      |

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
   is missing or over 25 MB), then in one transaction flips the upload to
   `processing` and sends the pg-boss job `contactUploadProcess`
   (`src/jobs/`), grouped by org with `groupConcurrency: 1` so an org's
   uploads never run at once. Neither route reads the file, so request time
   does not grow with it. Only the confirm whose `updateMany` moves the
   upload out of `awaiting_file` sends the job; if the send fails the
   transaction rolls back, the upload stays `awaiting_file` and the route
   502s. A repeat or overlapping confirm returns the upload as it is. Both routes 503 when the bucket is unset, so importing locally
   needs the dev bucket and AWS access. Bucket CORS:
   `deploy/components/contact-uploads-bucket.ts`.
2. **Read the file** (`services/contactUploadProcessJob.service.ts`), the
   first phase of the job, while `ingestedAt` is null: streams the object
   from S3 (`S3Service.getFileStream`), parses by the user's chosen headers
   (`readContactUploadCsv`, `util/contactUploadCsv.util.ts`), normalizes
   (email lowercased and validated, phones to `(xxx) xxx-xxxx`, ZIP to 5
   digits) and inserts rows 5,000 per `createMany({ skipDuplicates: true })`,
   each its own statement with no wrapping transaction. `(uploadId, rowIndex)`
   is unique, so a retry re-reads the file and skips what landed. Then
   it sets `ingestedAt` and `rowCount` and falls through to matching in the
   same attempt. A row without first and last name is `invalid`. A file that
   can never import (a mapped column missing, over 100,000 rows, no rows,
   unreadable, or gone from the bucket) throws `ContactUploadFileError`: the
   upload goes `failed` on the first attempt with the error's message as
   `failureReason`, which the UI shows, and `failureKind` `file`, and its
   partial rows are deleted. Every other failure is retried (6 attempts,
   backoff from 30s); the last attempt marks the upload `failed` with
   `failureKind` `transient`, then throws so the job lands in the
   dead-letter queue and alerts. The UI offers Try again only for
   `transient`, since retrying a bad file fails the same way.
3. **Match**, the second phase of the same job, chunk by chunk until no
   pending rows remain: up to 4,000 pending rows a chunk, cut shorter when
   the rows' JSON would pass 800,000 characters
   (`fitContactUploadMatchRows`): Databricks rejects a bound parameter over
   1,048,576. Between chunks the job stops if pg-boss aborted it (a task
   shutting down), and the retry resumes. Per chunk, in order: duplicates within the chunk, the org's earlier
   rows in Postgres (email, then phone + last name, then name + address,
   then for a name-only row a name-only row the user resolved by hand,
   when every such row with that name points to one person),
   then one Databricks statement per chunk
   (`peopleDb/databricks/contactUploadMatchSql.util.ts`, through
   `VoterQueryService.matchContactUploadRows`). A candidate is a district
   person with the row's last name (letters only) and a first name that is
   exact, an alias, a prefix (the shorter at least 3 letters) or a typo
   (`levenshtein` at most 1 under 5 letters, else 2); anyone else is not
   offered. Aliases come from `data/nicknames.csv` (vendored from
   github.com/carltonnorthern/nicknames, Apache 2.0, license beside it):
   `firstNameAliases` sends each row's name, its nicknames and the names it
   is a nickname of with the row. Never their other nicknames: that walk
   links Bob to Bill and Ron to Erin. Databricks
   built-ins only, no UDF or table
   (`docs/adr/2026-11-03-contact-upload-first-names-match-by-builtins-and-nicknames.md`).
   `decideFromCandidates` (`util/contactUploadMatching.util.ts`) scores
   each candidate with point constants (first name, phone agrees, address
   agrees) that the statement's top-10 ordering also uses. It matches only
   a candidate whose first name is not a typo, whose phone or address
   agrees, and who outscores every other; otherwise any candidates are
   `needs_input` by score, suggesting one only when it is the lone
   candidate and its first name is exact. Nothing about scores is stored.
   New people get a uuid v7. Each chunk commits on its own and only `pending` rows are
   worked, so a retry resumes. A row landing on someone an earlier
   upload already gave values gets `changedFields`.
   Counts are never incremented: finalize, a review PUT and accept-suggested
   each recompute all of them from one grouped count over the upload's rows
   (`countOutcomes`, `util/contactUploadCounts.util.ts`), so a repeated
   attempt cannot double-count. Until then the counts read 0, so a
   `processing` upload's `progress` (on `GET /` and `GET /:id`) comes from
   one grouped count of its rows by outcome (`progressOf`): `added` is
   matched, new and resolved, `needsInput` is `needs_input`. The email
   flow's status line reads it. Updated is a row with `changedFields`;
   unchanged is a `prior_upload` row without.
4. **Review**: `needs_input` rows wait until the user picks. Candidate
   details are read from Databricks by id (`VoterQueryService.findPeople`
   with an `id` filter) for the page being shown, never stored.
5. **Undo** (`ContactUploadsService.undoUpload`), for a `complete`,
   `needs_input` or `failed` upload (`CONTACT_UPLOAD_UNDOABLE_STATUSES`;
   409 while `processing`, since the job is still writing rows). It deletes
   the file (`ContactUploadFilesService.deleteFiles`), then the
   `contact_upload` row, which cascades to its rows. The overlay view reads
   only rows, so the upload's values leave every people read at once, and a
   person it added leaves with them unless another upload's row points at
   them (`newPeopleOnlyIn`). A later upload that matched such a person
   (`prior_upload`) keeps its rows untouched: its `isNewPerson` was copied,
   so that person stays new with the later upload's values, and that upload
   becomes their first import in the feed. Other uploads' counts are not
   recomputed: they record what happened when they ran. Notes, statuses,
   interactions and outreach stay on their person ids, as with Change
   match; `undo-preview` returns `hasActivity` for the people it removes so
   the UI warns first. Fires `Contacts - Import Undone` (counts only).

## How a row was matched

Each `contact_upload_match` row records how it got its person, so Databricks
(through federation) and SQL can answer it without the event stream:

- `method`: `prior_upload`, `name_and_phone` or `name_and_address` from the
  job; `manual` once a user settles the row.
- `first_name_match` (`exact`, `alias`, `prefix`, `typo`): the winning
  candidate's first-name level, set only when the job matched the row to a
  voter file person. Null for prior-upload, new, invalid and `needs_input`
  rows. A later Change match keeps it, so an overridden nickname match is
  still countable.
- `resolution`: how a user settled the row, last write wins. `candidate` (a
  person in the row's `candidatePersonIds`, which a review row keeps after it
  is settled), `search` (anyone else; every pick on an auto-matched row),
  `suggestion` (accept-suggested), `new_person`, `skip`. Null for rows nobody
  touched.

## Events

gp-api fires these through `AnalyticsService` (`EVENTS.Contacts`), each with
`product`; the wizard's own events are in
`gp-webapp/docs/contacts-analytics.md`.

- `Contacts - Import Completed`: the job finished. Outcome counts,
  `emailsGained`, `isReimport`, and voter file auto-matches by first-name
  level: `matchedExactName`, `matchedNickname`, `matchedPrefix`.
- `Contacts - Import Failed`: the job marked an upload `failed`. `uploadId`, `failureKind`, `rowCount`
  (null until the file was read).
- `Contacts - Ambiguous Row Resolved`: a `needs_input` row settled, one event
  per row or one per accept-suggested call (`rowCount`). `resolution` takes
  the column's values.
- `Contacts - Match Changed`: Change match on a settled row, `from`, `to`
  and `resolution`.

## Things that look like bugs but aren't

- **An upload can stay `processing` with its job dead-lettered.** The last
  attempt marks the upload failed only if the worker gets to run its error
  handling. If the task dies during that attempt (out of memory, or a
  deploy past the shutdown grace), pg-boss dead-letters the job and the
  upload stays `processing`. `jobs-dead-letter` pages; redriving the job
  resumes the import from its pending rows (`src/jobs/AGENTS.md` § Dead
  letters).
- **`isNewPerson` is copied, not recomputed.** A row that reuses an earlier
  row's person takes that row's `isNewPerson`, because the overlay view ANDs
  it across a person's rows.
- **On a re-import, the counts and `inVoterFile` disagree on purpose.** The
  counts say whether a row's person was already on the org's list (every
  `matched` row, `prior_upload` included); `inVoterFile` says whether that
  person is in the voter file (`!isNewPerson`), as Swain decided.
- **Change match and undo do not move history.** Notes, statuses and
  interactions stay on the old person id; `hasActivity`
  (`ContactUploadMatchService.hasActivity`) is there so the UI can warn.
- **Uploads never clear opt-outs, blocks or unsubscribes.** A file cannot
  reopen anyone who opted out.
- **No names, emails or phones in logs or analytics.** Ids and counts only.

## Deleting files

The bucket is versioned and nothing in it expires, so a file is gone only
when every version and delete marker of its key is deleted
(`S3Service.deleteAllObjectVersions`: `ListObjectVersions` per key,
exact-key matches only, `DeleteObjects` in batches of 1,000).
`ContactUploadFilesService.deleteFiles` takes `contact_upload` rows and does
that per org, logging the org slug and rethrowing on failure. It works from
the rows' `fileKey`s, never a bare `<orgSlug>/` prefix: previews and local
share the dev bucket with their own databases, where `campaign-<id>` slugs
collide with dev's. That is complete, because presign creates the row
before the browser can PUT, so every object has a row. The task role holds
`s3:ListBucketVersions` and `s3:DeleteObjectVersion` on this bucket
(`deploy/index.ts`). A preview's role is capped by the ops-owned
`GpApiPreviewRoleBoundary`, which grants the same on
`gp-api-contact-uploads-dev`, the bucket previews share; a new S3 action
here needs the boundary widened in ops first, or it is `AccessDenied` on
previews.

Every path that deletes an org reads its rows before the database delete
and deletes the files:

| Path                                                         | Where it deletes the files                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Account deletion, self and admin (`UsersService.deleteUser`) | In the transaction, after the Stripe cancel and before Clerk; a failure rolls the delete back |
| Test-user sweep (`UsersService.deleteTestUsers`)             | Before each user's delete; a failure skips that user until the next hourly pass               |
| Test mode org delete (`TestModeService.deleteOrganization`)  | In the transaction, after the org delete; a failure rolls it back                             |
| Judge chat fixture teardown (`removeChatOrgFixture`)         | In the transaction, after the org delete; a failure rolls it back                             |
| Undo one upload (`ContactUploadsService.undoUpload`)         | Before the upload's delete; a failure keeps the upload, and a repeat undo deletes the row     |

A new path that deletes users or organizations has to do the same.

**Abandoned uploads.** `ContactUploadAbandonedSweepService`
(`contactUploadAbandonedSweep`, `43 * * * *`, hourly claim) deletes up to
200 uploads a run, oldest first, still `awaiting_file` 24 hours after
creation (the browser closed before the PUT or the confirm; the presigned
URL lasted 15 minutes). The file goes first and the row only after, and
only while it is still `awaiting_file`, so a failed delete leaves the row
for the next run. No deploy allowlist: it touches only this deploy's rows,
and their keys carry the upload's uuid. Logs counts.

## Tests

`tests/contactUploads.routes.test.ts` drives everything through
`useTestService()` (a Serve org, plus a `Win campaigns` block for Pro,
non-Pro and flag off), standing in for the bucket by spying
`S3Service.getSignedUrlForSizedUpload`, `headObject` and `getFileStream`,
spying
`VoterQueryService.matchContactUploadRows` and
`findPeople` for Databricks and calling the job's `process()` directly with
a plain `JobRun`. `tests/contactUploadProcess.jobs.test.ts` runs the real
pg-boss worker (`useTestService({ jobs: true })`). Pure logic: `util/*.test.ts`; the statement:
`peopleDb/databricks/contactUploadMatchSql.util.test.ts`.
The statement running in Databricks against real voters: gp-webapp's
`e2e-tests/tests/app/contacts/import-contacts-matching.spec.ts`, which
picks the default office's voters through `GET /v1/contacts`, uploads a CSV
through presign, the bucket and the queue job, and asserts each row's
outcome (exact, nickname, prefix, typo, shared-name, name-only, invented
surname, namesake). It runs on PR previews.
Undo: the `undoing an upload` block in `tests/contactUploads.routes.test.ts`,
including a later `prior_upload` import keeping its person, values, sources
and feed row. The E2E
`e2e-tests/tests/app/contacts/import-contacts-undo.spec.ts` imports through
the API path, undoes it from the upload's page, and checks the person's
sources and Import history. People search is checked only where the overlay
reads the test's own database (dev): previews read dev's overlay
(`gp_api_contact_overlay_dev`) but write their own cloned database, so a
preview's imports never reach people reads.
The wizard in a browser:
`e2e-tests/tests/app/contacts/import-contacts-wizard.spec.ts` picks a CSV
through the file input, maps its columns by hand, affirms consent, so the
browser's own PUT meets the bucket's CORS rules, then waits on the upload's
page for the job to finish and undoes it.
File deletion: `tests/contactUploadAbandonedSweep.test.ts`, the
`deleteAllObjectVersions` block in `vendors/aws/services/s3.service.test.ts`,
and one test per deletion path in `users/users.routes.test.ts`,
`users/services/users.service.test.ts` (sweep),
`testMode/tests/testMode.routes.test.ts` and
`testFixtures/testFixtures.judge.routes.test.ts`, each spying
`S3Service.deleteAllObjectVersions`.
