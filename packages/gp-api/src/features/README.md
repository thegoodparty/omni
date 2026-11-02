# `src/features/`

Feature-flag service. Wraps Amplitude Experiment for runtime feature toggles.

`services/features.service.ts` is the public surface. Inject it; ask it whether a flag is on for a user. Don't read `process.env` for feature toggles — go through this service so flags can be changed without redeploys.

## Flags that roll out by organization

`ORGANIZATION_FLAGS` (today only `issue-capture`) follow the org, not the person. Amplitude buckets by user id, so a percentage or cohort rollout read per person would split a candidate from their own volunteers. Two rules keep them consistent:

- A route gated on one passes the org's owner, `isFeatureEnabled({ user: organization.ownerId, feature })`, never the requester (`constituentFeedback.controller.ts`).
- `GET /v1/experiment/variants` takes the request's org (`@UseOrganization({ continueIfNotFound: true })`, `@AllowVolunteer()`), and `getAllVariants(user, organization)` returns these flags from the owner's evaluation and every other flag from the user's. A slug the user is no member of reads as no org. A failed owner evaluation leaves the flag out, which reads off. The webapp re-resolves on an org switch (gp-webapp `docs/feature-flags.md`, Org-scoped flags).

Adding a flag to the set changes who it is evaluated for on every surface at once, so add it before its first rollout, not during one.
