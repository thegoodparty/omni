---
title: People reads join an org's imported contacts at read time, in the SQL gp-api writes
status: active
decided_by: [swain]
date: 2026-10-29
code: []
scope:
  - packages/gp-api/src/peopleDb/databricks/databricksVoterSql.util.ts
  - packages/gp-api/src/peopleDb/databricks/databricksVoter.service.ts
  - packages/gp-api/src/peopleDb/services/peopleDataset.service.ts
  - packages/gp-api/src/chats/general/chief-of-staff/services/constituentDataScope.ts
  - packages/gp-api/src/llm/tools/queryConstituentData.tool.ts
supersedes: []
superseded_by:
---

# People reads join an org's imported contacts at read time, in the SQL gp-api writes

## Decision

For a Serve org with `serve-import-contacts` on, every people read joins the
district's L2 rows to that org's imported contacts when the read runs.
`PeopleDataset` carries the org slug and its district, and
`DatabricksVoterService.resolveDistrict` renders `district.table` as the
district-filtered `gp_api_voters` or `gp_api_constituents` rows FULL OUTER
JOIN the org's rows of the `gp_api_contact_overlay` dbt view, which reads
gp-api's `contact_upload_match` table live through Lakehouse Federation.
gp-api writes the org slug, state and district into the statement. The
Serve agents get the same join over `serve_agent_contact_overlay`, swapped in
after their SQL validator runs. Turning the flag off returns an org to the
plain table at once.

## Context

Every people read already took its table from one place, `resolveDistrict`,
so one seam reaches contacts, lists, outreach, the civic panel, priorities
and the agents. L2 rows carry no org, and Databricks does not know an org's
district: gp-api resolves it from the election database, and several reads
pass a district other than the org's own. Uploads must show up as soon as
matching finishes, because the user opens a person they just imported.

## Alternatives rejected

- **One Databricks view keyed by org slug.** The view would have to map each
  org to its district, and joining through a district column that differs by
  district type cannot use the clustering behind today's literal state and
  district filter. Measured at 6.7 to 7.2 seconds against 3.1 seconds today,
  before any upload data.
- **A scheduled dbt table instead of a live view.** Cheaper reads, but
  imported people would not exist until the next run.
- **gp-api sends the overlay inline as a VALUES table.** The merge rule would
  live only in gp-api, analysts and agents could not see uploads, and a
  100,000-row org would add about 10 MB to every statement.

## Revisit if

Federated reads load Aurora or the 20-connection proxy cap too heavily. The
scheduled table is the fallback, under the same view name.
