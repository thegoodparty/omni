import { z } from 'zod'

// The single source of truth for "what env vars does gp-webapp read". Every
// name here is grepped straight from `process.env` reads under this package
// (excluding `e2e-tests/`, which is its own test-shaped contract — see
// `e2e-tests/.env.example`) and reconciled against `.env.example`. Bare
// import only: no Next.js runtime, so this can be required from a plain
// script or a CI check.
//
// Tiers describe what SHOULD gate boot, not what does today.
//
// - required    — boot should fail fast without it.
// - degradable  — missing/placeholder disables one named feature surface.
// - optional    — a setting, tunable, or vendor key with no boot dependency.
//
// gp-webapp has no `degradable` entries today: every non-Clerk var either
// has a hardcoded fallback in `appEnv.ts` (the fallback IS the degraded
// behavior — not re-modeled here) or is a platform-set value with no
// user-facing feature attached to its absence.
export type EnvVarTier = 'required' | 'degradable' | 'optional'

export type EnvVarSpec = {
  tier: EnvVarTier
  // Required on every `degradable` entry: the feature surface that goes
  // dark when this var is absent or left at its placeholder.
  feature?: string
  // The sentinel `.env.example` ships for this var.
  placeholder?: string
  // The value the reading code falls back to when unset, where one exists.
  default?: string
}

export const ENV_VAR_CONTRACT: Record<string, EnvVarSpec> = {
  // --- Required: boot fails fast without these ------------------------
  // Read directly by @clerk/nextjs (ClerkProvider client-side, `auth()` /
  // `clerkMiddleware()` server-side) — not a literal `process.env.X` in our
  // own code, but middleware.ts and PageWrapper.tsx both depend on the SDK
  // having them.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: { tier: 'required' },
  CLERK_SECRET_KEY: { tier: 'required' },

  // --- Optional: everything else ---------------------------------------
  NODE_ENV: { tier: 'optional' },
  // Vercel-set on every deployed build; unset locally.
  NEXT_PUBLIC_VERCEL_TARGET_ENV: { tier: 'optional' },
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: { tier: 'optional' },
  NEXT_PUBLIC_VERCEL_BRANCH_URL: { tier: 'optional' },
  VERCEL_ENV: { tier: 'optional' },
  NEXT_RUNTIME: { tier: 'optional' },
  CI: { tier: 'optional' },

  // Sign-in/sign-up URLs and redirects — read directly by @clerk/nextjs, not
  // a literal `process.env.X` in our own code (see the required pair above).
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: { tier: 'optional' },
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: { tier: 'optional' },
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: { tier: 'optional' },
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: { tier: 'optional' },

  // appEnv.ts constants. Most have a hardcoded fallback, so the fallback is
  // the degraded behavior and isn't re-modeled here; the two vendor keys
  // that don't (Amplitude, Segment) are still boot-independent settings, not
  // a gated feature surface, so they stay optional rather than degradable.
  NEXT_PUBLIC_API_BASE: { tier: 'optional' },
  NEXT_PUBLIC_ELECTION_API_BASE: { tier: 'optional' },
  NEXT_PUBLIC_AMPLITUDE_API_KEY: { tier: 'optional' },
  NEXT_PUBLIC_SEGMENT_WRITE_KEY: { tier: 'optional' },
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: { tier: 'optional' },
  NEXT_PUBLIC_GOOGLE_MAPS_KEY: { tier: 'optional' },
  NEXT_PUBLIC_GEOAPIFY_TILES_KEY: { tier: 'optional' },
  NEXT_PUBLIC_CANDIDATES_SITE_BASE: { tier: 'optional' },
  NEXT_PUBLIC_GP_ADMIN_URL: { tier: 'optional' },
  NEXT_PUBLIC_P2P_CUTOFF_DATETIME: { tier: 'optional' },
  NEXT_PUBLIC_MARKETING_SITE_DOMAIN: { tier: 'optional' },
  // Read by the deprecated gpApi/gpFetch.ts legacy fetch helper
  // (`process?.env?.NEXT_PUBLIC_APP_BASE`) — a plain grep for the literal
  // `process.env.X` misses this optional-chaining form.
  NEXT_PUBLIC_APP_BASE: { tier: 'optional' },

  NEXT_PUBLIC_SUPPORT_CHAT: { tier: 'optional' },
  NEXT_PUBLIC_DICTATION_DEMO_ENABLED: { tier: 'optional' },

  // Dev-only local briefing/issue galleries (app/dev/*); both hard-404 when
  // NODE_ENV !== 'development'.
  LOCAL_BRIEFINGS_DIR: { tier: 'optional' },
  LOCAL_ISSUES_DIR: { tier: 'optional' },

  // Shared secret gating the machine-triggered cache-revalidation endpoint
  // (app/api/revalidate/route.ts). Fails closed when unset — the endpoint is
  // unusable, not open — so it's a setting, not a boot dependency.
  REVALIDATE_SECRET: { tier: 'optional' },

  // Build-time only: Sentry source-map upload during `next build`.
  SENTRY_AUTH_TOKEN: { tier: 'optional' },
}

export const envSchema = z.object(
  Object.fromEntries(
    Object.entries(ENV_VAR_CONTRACT).map(([name, spec]) => [
      name,
      spec.tier === 'required' ? z.string().min(1) : z.string().optional(),
    ]),
  ),
)

export type EnvContract = z.infer<typeof envSchema>
