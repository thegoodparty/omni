# Feature Flags

Feature flags are powered by **Amplitude Experiment**, resolved **server-side by gp-api**. gp-api evaluates Amplitude server-to-server; gp-webapp embeds the result in the SSR render (the "seed") and the client provider (`app/shared/experiments/FeatureFlagsProvider.tsx`) reads from it and exposes hooks. **The browser never calls Amplitude for flag resolution** — so an ad blocker or blocked network can't affect which gated surfaces render. On an identity change the provider re-resolves through the same-origin `GET /api/feature-flags` (which wraps the server resolver `getFlagVariants`), never Amplitude directly.

## Hooks

```ts
import {
  useFeatureFlags,
  useFlagOn,
} from '@shared/experiments/FeatureFlagsProvider'

// Boolean check — most common use case
const { ready, on } = useFlagOn('my-feature-key')
if (!ready) return <Spinner />
return on ? <NewUI /> : <OldUI />

// Full variant (e.g. multi-arm experiment)
const { ready, variant } = useFeatureFlags()
const v = variant('my-feature-key')
// v.value: undefined | 'control' | 'treatment-a' | ...
```

`useFlagOn(key)` is the right default. Reach for `useFeatureFlags` only when you need the variant payload, all flags at once, or to fire an explicit `exposure()`.

## Components

### `FeatureFlagGuard`

Redirects away from a route if the flag is off. Use as a route-level wrapper:

```tsx
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'

export default function Page() {
  return (
    <FeatureFlagGuard flagKey="my-feature-key" redirectTo="/dashboard">
      <MyFeature />
    </FeatureFlagGuard>
  )
}
```

While the flag is loading, the guard renders a centered spinner. While the flag is off, it returns `null` and triggers a `router.replace`.

## Per-flag wrapper hooks

When a flag is read in many places, wrap it once and export a named hook so the key is centralized. Example: `app/shared/experiments/campaignStoryFlag.ts`:

```ts
export const CAMPAIGN_STORY_FLAG_KEY = 'campaign-story'

export const useCampaignStoryFlag = (trackExposure = true) => {
  const { ready, on } = useFlagOn(CAMPAIGN_STORY_FLAG_KEY, { trackExposure })
  return { ready, enabled: on }
}
```

This keeps the key out of feature code and gives you one place to remove the flag when the experiment ends.

## Resolution and re-resolution

The SSR seed is resolved for the authenticated user by gp-api. Client-side, the provider re-resolves through `/api/feature-flags` when the identity changes — keyed on the user's segment-relevant traits (`helpers/buildUserTraits.ts`: email / name / phone / zip) plus id, so a same-session trait edit re-evaluates, not just a login/logout. It does **not** call Amplitude.

**Anonymous visitors get no flags — every flag reads `off` and the client makes no resolution call.** This is by design: the client never talks to Amplitude, and gp-api only resolves for an authenticated user. A flag that must be on for a logged-out / marketing page therefore will not work through this provider — resolve it another way.

## E2E overrides

Because the browser never fetches Amplitude, an e2e test can't stub a variant. Instead `getFlagVariants` merges an `e2e-flag-overrides` cookie over gp-api's result (`app/shared/experiments/flagOverrides.ts`), so a test can force a flag deterministically. The Playwright helper sets it via `enableCampaignStoryFlag(page)` (`e2e-tests/src/helpers/campaignStory.helper.ts`).

It's honored on every environment **except production** (`process.env.VERCEL_ENV === 'production'` — Vercel's reserved runtime var, not the unreliable `NEXT_PUBLIC_VERCEL_TARGET_ENV`), read only from a cookie, and schema-validated. Flags gate UX, not authz, so the off-prod blast radius is the requester's own gated UI.

## Server-side flags

The **provider and its hooks are client-only**, so a server component can't call `useFlagOn`. It can, however, call the same resolver that produces the SSR seed: `await getFlagVariants()` returns the variant map (or `null` for an anonymous request or a gp-api failure, in which case every flag reads off). That is the way to gate a route without rendering it at all:

```tsx
// app/dashboard/<feature>/layout.tsx — server component
const variants = await getFlagVariants()
if (variants?.[MY_FLAG_KEY]?.value === 'on') {
  redirect('/somewhere-else')
}
```

Reach for this when the gated surface must not render or fetch — `door-knocking/surveys/layout.tsx` redirects pilot users away from the legacy eCanvasser survey designer before its eCanvasser reads run. It costs one extra gp-api call per request, and it emits no `$exposure` (exposure is a client-side analytics event), which is correct for a surface that isn't the experiment's treatment. For the ordinary case — flag off means "don't show this route" — the client `FeatureFlagGuard` is still simpler and free.

## Adding a new flag

1. Create the flag in Amplitude Experiment with a stable key (kebab-case, e.g. `outreach-bulk-send`).
2. If the key is read in more than one component, add a wrapper hook under `app/shared/experiments/`.
3. Use `useFlagOn(key)` (or your wrapper) at the call site.
4. **Removing the flag**: delete the wrapper hook + key constant, then grep for stragglers.

## Anti-patterns

- Don't read flags during render without the `ready` check — variant defaults to `undefined` while loading and you'll flash the wrong branch.
- Don't keep flags around forever. Once an experiment ships, delete the gate.
- Don't gate critical security checks behind a feature flag — gate the UX, but enforce auth/permission in `app/dashboard/shared/candidateAccess.ts` (client) / `serveAccess.ts` (server) and at gp-api.

## Related

- `app/shared/experiments/FeatureFlagsProvider.tsx` — provider + hooks.
- `app/shared/experiments/FeatureFlagGuard.tsx` — route-level guard.
- `app/shared/experiments/getFlagVariants.ts` — server resolver (SSR seed).
- `app/api/feature-flags/route.ts` — same-origin endpoint the client refreshes through.
- `helpers/buildUserTraits.ts` — segment traits keying client re-resolution.
