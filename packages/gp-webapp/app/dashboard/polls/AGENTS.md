# app/dashboard/polls/

Custom polling. Campaigns commission AI-assisted polls of their district, pay (Stripe), and view results. Public poll-share pages live separately under `app/polls/`.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Polls list — `PollsPage` + `PollsTable` |
| `create/` | Multi-step poll creation flow |
| `[id]/` | Poll detail + extension flows (`expand/`, `expand-payment/`, `expand-payment-success/`, `expand-review/`, `issue/`) |
| `components/` | List-page widgets (`PollPreview`, `PollImageUpload`, `StatusBadge`, scheduled-date selector) |
| `shared/components/` + `shared/hooks/` | Reused across create + detail (form fields, validation hooks) |

## Patterns

- **`[id]/expand*` are payment sub-flows**, not separate pages — a campaign extends an existing poll's reach by paying more. Each step (review → payment → success) is its own route.
- **Status badge** semantics live in `components/StatusBadge.tsx` — single source of truth for status colors / labels.
- **Image upload** pattern (`PollImageUpload`) is poll-specific; for general uploads use shared inputs from `app/shared/inputs/`.
- Stripe checkout-session redirect pattern (not Stripe Elements) — payment flows hand off to gp-api, return via `expand-payment-success`.

## Gotchas

- The public poll-results page (`/polls/[slug]`) lives at `app/polls/`, NOT here. Don't conflate dashboard poll detail with the public share view.
- `shared/` here is poll-feature-shared, not app-wide shared. App-wide stuff is at `app/shared/`.
- Poll status transitions (draft → scheduled → running → complete) are gp-api-driven; the dashboard reflects state, doesn't drive it.
- **Polls blocks entirely when the org has no resolvable district** (2026-08-06). Polls is Serve-only and Serve has no Pro gate (`canUseProFeatures` is always true for an `eo-` org), so `useDistrictResolution` (`app/dashboard/shared/`) is the only protection. 35 of 1,875 Serve orgs are in this state, almost all from a write-in office name. `GET /v1/contacts/stats` 400s for them, and `calculateRecommendedPollSize` was turning the resulting undefined total into `NaN` via `MAX_CONSTITUENTS_PER_RUN - undefined` — straight into the audience options and cost preview. A poll against an unknown audience can't be priced, so the product call was to block: `polls/onboarding/OnboardingPage` renders a terminal state (mirroring `NotEnoughConstituents`) and both `CreatePoll` and `ExpandPollPage` branch on `useTotalConstituentsWithCellPhone().isUnavailable`. All of them route to `/dashboard/contacts`, which already explains the missing district and offers support — polls deliberately does not repeat the handoff.
- **`useTotalConstituentsWithCellPhone` returns `isUnavailable`, and you must branch on it before any `status !== 'success'` check.** Both consumers render a spinner on non-success, and a district-gated query is neither success nor error — so `enabled: false` alone spins forever. Same reason `ConfidenceAlert` gates by *not calling* `prefetchQuery`, which ignores `enabled` entirely.
- The `< 500` viability guard in `OnboardingPage` requires `statsQuery.data`, so it never fired for an unresolvable org — they fell straight through it. The district check runs before it.

## Related

- `app/polls/` — public poll-share pages.
- `app/shared/inputs/` — generic form inputs the create flow uses.
