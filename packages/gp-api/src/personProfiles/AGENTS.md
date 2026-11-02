# AGENTS.md

Public `/people` profiles: the owner's editor (`/v1/person-profiles/mine`),
the public reads gp-marketing renders (`/v1/public-person-profiles`), and the
admin takedown and link routes gp-admin calls.

## How a user gets linked to their person

A profile is keyed on the civics Person id (`User.personId`), and the editor
stays on "still setting up your official record" until that is set
(`canCreate` in `GET /mine`). `PersonIdBackfillService` owns every write:

| Path | When | What |
| --- | --- | --- |
| `linkUserIfMissing` | every `GET /mine` | Links an unlinked user from `person.gp_api_user_id` |
| `reconcileNullPersonIds` | 04:00 UTC | Same, for the lowest 500 unlinked users with a campaign or office |
| `reconcileDriftedPersonIds` | 04:00 UTC | Re-resolves profile owners and takedown subjects; repoints when the person moved |
| `linkUserByOperator` | `POST /links` (gp-admin) | Hand-links an unlinked user to a live person nobody else holds |

The data platform's people mart publishes `gp_api_user_id` only when a person
group holds exactly one gp-api account. The warehouse copy of the users table
keeps deleted accounts, so a duplicate or deleted-and-recreated signup leaves
the group with none. Two fallbacks cover that:

- The drift sweep follows the stored id's merge record when the user lookup
  is empty, so an owner whose id was retired in a merge still reaches the
  survivor.
- An unlinked user in such a group can only be linked by an operator, from the
  Public profile card on the gp-admin user page.

A repoint never takes an id another user holds, and never splits a user's
rows: the link, profile, takedown and claim requests move together or not at
all. `docs/adr/2026-10-22-operator-person-link.md` records why the operator
route only links and never moves.
