# Scale

How big the data is, and the limits already in code. Use it to name a realistic N
when you review or write a query, loop or list. A scale finding needs an N from
this doc and the operation that breaks at that N. `TBD (data team)` means no number
exists in the repo: do not guess one, ask the data team.

## Sizes

All counts are aggregate. Date read: 2026-11-05.

| What | Value | Source |
| --- | --- | --- |
| Voter rows, `mart_gp_api.gp_api_voters` | ~219M | `docs/features/recommended-lists.md:54` |
| Largest district, constituents | 23.3M | `packages/gp-api/src/peopleDb/AGENTS.md:235` |
| Statewide district, `constituents` | ~21.5M | `packages/gp-api/src/peopleDb/AGENTS.md:421` |
| Smallest district measured | ~1k | `packages/gp-api/src/peopleDb/AGENTS.md:235` |
| Large congressional district (PA-12) | 529,131 registered | `docs/features/recommended-lists.md:91` |
| Voters per district, median: state, county, city, school board | TBD (data team) | none in repo |
| Voters per district, largest: county, city, school board | TBD (data team) | none in repo |
| Contacts per campaign: median, p95, max | TBD (data team) | none in repo |
| Contacts per org: median, p95, max | TBD (data team) | none in repo |
| Largest gp-api tables by row count | TBD (data team) | none in repo |
| people-db tables in Databricks, other than `gp_api_voters` | TBD (data team) | none in repo |
| Largest saved voter-file filter or list | TBD (data team) | none in repo |
| Largest outreach audience sent | ~82,000 recipients, resolution outran the gateway (INC-101) | `packages/gp-api/src/vendors/peerly/services/p2pPhoneListUpload.service.ts:849` |
| gp-api ECS task memory, prod / non-prod | 4096 MB / 2048 MB, 1 vCPU | `packages/gp-api/deploy/components/service.ts:335` |

## Limits already in code

| Limit | Value | Source |
| --- | --- | --- |
| Audience page size | 1,000 | `contacts/utils/audienceResolution.util.ts:76` |
| Audience cap per resolution | 200,000 | `contacts/utils/audienceResolution.util.ts:77` |
| Interactive resolution budget | 90 s (gateway gives up at ~120 s) | `contacts/utils/audienceResolution.util.ts:106` |
| Peerly phone list recipients | 200,000 (page 1,000) | `vendors/peerly/services/p2pPhoneListUpload.service.ts:53` |
| CallHub phonebook numbers | 100,000 (page 1,000) | `outreach/services/robocallPhonebook.service.ts:24` |
| Outreach materialization page | 1,000 | `outreach/services/outreachMaterialization.service.ts:31` |
| Poll expansion excluded ids | 100,000 | `outreach/services/outreachServePollExpansion.service.ts:26` |
| Id filter `in` / `notIn` | 200,000 each | `packages/contracts/src/people/PeopleFilters.schema.ts:174` |
| Precinct filter values | 5,000 | `packages/contracts/src/people/PeopleFilters.schema.ts:239` |
| Door-knocking pack rows | 3,000,000 | `peopleDb/databricks/databricksVoterPack.service.ts:47` |
| Polygon preview people | 50,000 | `contacts/services/contacts.service.ts:196` |
| Contact upload rows | 100,000 | `packages/contracts/src/contactUploads/ContactUpload.schema.ts:5` |
| Page size / max offset | 10,000 / 1,000,000 | `packages/contracts/src/shared/Pagination.schema.ts:9` |
| Databricks statement bytes / bound params | 16,777,216 / 10,000 | `peopleDb/databricks/peopleDbxStatement.client.ts:24` |

Paths without a prefix are under `packages/gp-api/src/`.

## Known traps

- Ids as bound parameters in Postgres: Prisma `in: [...]` or raw `IN ($1..$n)` fails above 32,767 values (Prisma's documented limit; Postgres itself stops at 65,535, see `packages/contracts/src/people/PeopleFilters.schema.ts:172`). Any audience-sized id list can pass that. Pass one array parameter instead.
- Ids inlined into a Databricks statement: a request with `filters.id` plus both id-override pairs, each up to 200k uuids, can pass the 16 MB statement cap (`peopleDbxStatement.client.ts:20`). Past 10,000 bound values the statement is rejected.
- Per-page or per-row work over an audience on the request path: resolution has 90 s of a ~120 s gateway. A filter matching ~82,000 recipients outran it (INC-101, `p2pPhoneListUpload.service.ts:849`). Batch the call or move it off the request path.
- Whole district held in memory: `query()` accumulates every chunk (`peopleDb/AGENTS.md:414`). At ~65 bytes of heap per person, a ~21.5M-row statewide district exhausted the task heap (`peopleDb/AGENTS.md:420`). Stream chunks or refuse above `MAX_PACK_ROWS`.
- Unpaginated `findMany` or `query()` on a voter or contact table: breaks at any N above the 200,000 audience cap. Page by keyset (`afterId`), not OFFSET (`peopleDb/AGENTS.md:456`).
- OFFSET paging past 1,000,000 rows is refused by the contract cap; before that, each page re-sorts and skips everything before it.
- Per-person rows written for a list that should be a rule: an audience of up to 200,000 writes one row each. Persist the filter and resolve at send time. Whether a given org breaks depends on its largest list, which is TBD (data team).
- Vendor loads: CallHub ingests ~2,500 numbers/min, so 100,000 numbers takes ~40 min against an ~8 min poll window (`robocallPhonebook.service.ts:32`). Peerly files cap at 100 MB (`vendors/peerly/services/peerlyPhoneList.service.ts:31`).
- Contact upload above 100,000 rows is rejected at the contract. Match SQL input is capped at 800,000 chars (`contactUploadMatchSql.util.ts:53`).
