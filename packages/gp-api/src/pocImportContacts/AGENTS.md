# pocImportContacts (POC, do not merge)

Import contacts from a CSV into an org's contacts. Uploaded contacts live in
gp-api Postgres; Databricks reads mirrored copies of them through the
universal contacts view at the people-table seam. Everything is off unless
`POC_IMPORT_CONTACTS_ENABLED=true`: the routes 404 and every people read uses
the vendor table, the same as main.

## Flow

| Step | Route (`@UseOrganization`) | Store |
| --- | --- | --- |
| Upload and match | `POST /v1/poc/contacts/imports` | 1 Databricks read, then Postgres |
| Review a page of ambiguous rows | `GET /v1/poc/contacts/imports/:importId/ambiguous` | Postgres |
| Pick a person or skip | `PUT /v1/poc/contacts/imports/:importId/rows/:rowIndex/resolution` | Postgres |
| Commit | `POST /v1/poc/contacts/imports/:importId/commit` | one Postgres transaction, then the mirror shim |
| Counts over the view | `GET /v1/poc/contacts/counts` | Databricks |

Matching is one read-only statement per import against the org's district in
the vendor table: exact first + last name, trimmed, lowercased, hyphens
removed. Up to 20 candidates per row and the full count go into
`contact_import_row`. Logs carry counts and timings only, never names.

Commit writes one `org_contact` and one active `org_contact_link` per row. A
single candidate or a picked one links `verified` to the vendor person; a
skipped, unresolved or unmatched row gets an `unverified` link with no vendor
person. Tables: `prisma/schema/contactImport.prisma`.

## Universal contacts view

`src/peopleDb/databricks/universalContactsView.poc.ts`. `ContactsService`
runs every contacts read inside `universalContactsViewStorage`, and
`DatabricksVoterService.resolveDistrict` then returns the view as
`district.table`. The view filters the vendor table to the district first and
uses one FULL OUTER JOIN to the org's contacts (never a UNION: re-reading all
vendor columns doubled compile time). It adds `contact_id` (null for
vendor-only people), `contact_verified` (an in-district vendor person backs the
row) and `contact_email`, surfaced as `contactId`, `contactVerified` and
`contactEmail` on `Person`.

Reads that resolve the district through `resolveEligibleDistrict` and query
on their own (door knocking, phone banking, priorities, civic panel) leave the
store first, so they do not see uploaded contacts.

## Settings

| Env var | Meaning |
| --- | --- |
| `POC_IMPORT_CONTACTS_ENABLED` | `true` turns on the routes and the view |
| `POC_IMPORT_CONTACTS_MIRROR_SCHEMA` | `catalog.schema` holding mirrored `org_contact` and `org_contact_link`; defaults to `goodparty_data_catalog.poc_import_contacts_mirror` |
| `POC_IMPORT_CONTACTS_MIRROR_SHIM` | `true` MERGEs each commit's rows into that default schema (`services/pocMirrorShim.service.ts`), the stand-in until a phase-1 mirror exists |
| `POC_IMPORT_CONTACTS_VENDOR_TABLE` | local testing only: a table of synthetic people used in place of the vendor table (`sql/synthetic-vendor-people.sql`) |

With a phase-1 mirror, turn the shim off and point the mirror schema at it
(a Lakeflow or DMS target schema, or a federated catalog's `public` schema).
