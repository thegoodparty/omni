# CRM (HubSpot marketing sync)

The gp-api → HubSpot marketing sync: user/campaign contacts, team-member
contacts, and company records in the marketing portal (21589597). **Not**
the product CRM feature (`src/contacts/` — voter/constituent audience,
saved filters, outreach). `src/personProfiles/` also writes to HubSpot
contacts directly (candidate profile-completion counter) rather than
through this module.

## Key files

| Path                                | Owns                                                             |
| ------------------------------------ | ----------------------------------------------------------------- |
| `hubspot.service.ts`                 | The configured `@hubspot/api-client` `Client` instance            |
| `crmTeamMembers.service.ts`          | Team-member contact upsert + company association (ENG-10826)      |
| `util/hubspotErrors.util.ts`         | `extractExistingContactId` — shared 409-conflict parsing (ENG-11029), used by this module and `crmUsers.service.ts` |
| `crm.types.ts`                       | `CRMContactProperties` / `CRMTeamMemberContactProperties` shapes   |
| `../users/services/crmUsers.service.ts` | User signup/profile → contact sync (`trackUserLogin`/`trackUserUpdate`) |
| `../campaigns/services/crmCampaigns.service.ts` | Campaign → company sync                                |

## Merge-tolerant contact lookups (ENG-11029)

The data team periodically merges duplicate HubSpot contacts. A merge folds
the absorbed contact's email in as a **secondary** email on the survivor,
whose primary email is different. Two consequences every contact-by-email
path must handle:

- **A search by the merged-away email still returns the survivor**, with a
  primary `email` property that differs from the search value. That is a
  successful lookup, not a mismatch — adopt `results[0].id`. Comparing the
  returned contact's primary email to the search email and treating a
  difference as an error silently drops the sync for every merged user (the
  bug this ticket fixed).
- **A create can 409** because the email already belongs to an existing
  (possibly merged) contact — a race between a stale/failed lookup and the
  create, or a merge that happened between the two. `@hubspot/api-client`
  surfaces this as an `ApiException` (`code === 409`) whose `body.message`
  carries the existing id (e.g. `"Contact already exists. Existing ID:
12345"`) — there's no structured field for it. `util/hubspotErrors.util.ts`'s
  `extractExistingContactId` parses it; both `createCrmContact` and
  `crmTeamMembers.upsertContact` call it and adopt the existing id (update
  it with the computed properties) instead of swallowing the error and
  returning undefined.

**Never write `hs_additional_emails`.** Overwriting it is the one way to
silently undo a merge from this side — it would blow away the secondary
email HubSpot just folded in. No code path in this repo writes it; keep it
that way.

**Cached ids survive merges.** `User.metaData.hubspotId` and
`Campaign.data.hubspotId` are never cleared on a lookup mismatch — HubSpot
transparently redirects reads/writes against a retired (merged-away)
contact id to the survivor, so `crm-person-profiles.service.ts` (which
updates by a cached `hs_contact_id` from the civics mart) needs no merge
handling of its own.
