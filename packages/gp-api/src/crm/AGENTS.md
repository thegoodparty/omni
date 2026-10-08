# CRM (HubSpot marketing sync)

The gp-api → HubSpot marketing sync: user/campaign contacts, team-member
contacts, and company records in the marketing portal (21589597). **Not**
the product CRM feature (`src/contacts/` — voter/constituent audience,
saved filters, outreach). `src/personProfiles/` also writes to HubSpot
contacts directly (candidate profile-completion counter) rather than
through this module.

**Test users never reach the portal.** Every contact/company write path —
`trackContact` and `submitCrmForm` (`crmUsers.service.ts`), `syncTeamMember`
(`crmTeamMembers.service.ts`), `trackCampaign` (`crmCampaigns.service.ts`),
`syncElectedOffice` (`crmOfficeHolder.service.ts`) — is gated on `isTestUser`
(`src/users/util/users.util.ts`). Dev, previews, and prod share this one
portal, so the E2E suite's `@test.goodparty.org` users (created on every
merge) were piling up as billable marketing contacts. A new sync path must
carry the same gate. The server gates are only half of it: HubSpot's tracking
script used to run on dev/previews too, and its collected-forms feature
created contacts straight from the browser when E2E filled the Clerk sign-up
form — so gp-webapp loads that script in production only (`app/layout.tsx`,
`supportChatEnabled`).

## Key files

| Path                                | Owns                                                             |
| ------------------------------------ | ----------------------------------------------------------------- |
| `hubspot.service.ts`                 | The configured `@hubspot/api-client` `Client` instance            |
| `crmTeamMembers.service.ts`          | Team-member contact upsert + company association (ENG-10826)      |
| `util/hubspotErrors.util.ts`         | `extractExistingContactId` — shared 409-conflict parsing (ENG-11029), used by this module and `crmUsers.service.ts` |
| `crm.types.ts`                       | `CRMContactProperties` / `CRMTeamMemberContactProperties` shapes   |
| `../users/services/crmUsers.service.ts` | User signup/profile → contact sync (`trackUserLogin`/`trackUserUpdate`) |
| `../campaigns/services/crmCampaigns.service.ts` | Campaign → company sync                                |
| `../electedOffice/services/crmOfficeHolder.service.ts` | Elected office → Office Holder custom object (DATA-2623) |

## Office Holder custom object (DATA-2623)

Every elected office write (`ElectedOfficeService.create`/`update`, the M2M
district change) upserts one Office Holder record by
`gp_api_elected_office_id` and links it to the user's Contact
(`metaData.hubspotId`) and, when the office came from a won campaign, the
campaign's Company (`data.hubspotId`). Magic-link users get their Contact id
from the HubSpot card's `hs_object_id`.

- **Field ownership is static.** The app owns `elected_date`,
  `sworn_in_date`, `pledged_at`, `onboarding_completed_at`, `self_reported`.
  The seat fields (`name`, `status`, position, state, party, term dates) are
  the data platform's; the app sends them only as a day-one snapshot — when
  the office is created, and on every write up to and including the one that
  completes serve onboarding. Don't add a seat field to post-onboarding
  writes, and never send the data platform's keys
  (`gp_elected_official_term_id`, `gp_person_id`, `br_*`, `source_systems`).
- **Config, per portal.** `HUBSPOT_OFFICE_HOLDER_SYNC_ENABLED` (`'true'` to
  run) plus the object type id and the two association type ids. Any unset
  value skips the sync. Prod's ids live in `deploy/index.ts`; dev and previews
  write to the same portal, so they stay unset there.
- **`name` is required by the object**, so a post-onboarding write to an
  office with no record yet fails loudly (logged + Slack) instead of creating
  a nameless record.

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
