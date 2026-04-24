---
'@goodparty_org/sdk': minor
---

- Add `client.organizations` resource with `get(slug)`, `list(options?)`, and `patch(slug, input)` methods. These call the M2M-capable admin endpoints (`GET /organizations/admin/:slug`, `GET /organizations/admin/list`, `PATCH /organizations/admin/:slug`) so SDK consumers can read and update any organization without a user context.
- Export the related types: `Organization`, `OrgPosition`, `OrgDistrict`, `OrganizationListItem`, `OrganizationOwnerSummary`, `ListOrganizationsOptions`, `PatchOrganizationInput`.
- Add a `patchRequest` helper to the internal `BaseResource` so resources can issue PATCH requests.
