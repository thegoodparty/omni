import { z } from 'zod'

// The single source of truth for "what env vars does gp-admin read". Every
// name here is grepped straight from `process.env` reads under this package
// (plus a handful resolved through a `<PREFIX>` indirection — see the
// GP_* and CLERK_TEST_* sections below — that a literal grep can't see) and
// reconciled against `.env.example`. Bare import only: no Next.js runtime, so
// this can be required from a plain script or a CI check.
//
// Tiers describe what SHOULD gate boot, not what does today.
//
// - required    — boot should fail fast without it.
// - degradable  — missing/placeholder disables one named feature surface.
// - optional    — a setting, tunable, or vendor key with no boot dependency.
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
  // Read directly by @clerk/nextjs (ClerkProvider / clerkMiddleware) — not a
  // literal `process.env.X` in our own code, but src/middleware.ts depends
  // on the SDK having them.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: { tier: 'required' },
  CLERK_SECRET_KEY: { tier: 'required' },

  // gp-admin is a single deployment that targets dev/prod at runtime via
  // Clerk org switch (src/shared/util/gpEnvironment.ts). Only the Dev side
  // gates boot — Prod's config lives solely in the one deployed instance
  // that actually serves both environments; local dev never needs it.
  GP_API_PROTOCOL: { tier: 'required' },
  GP_DEV_API_DOMAIN: { tier: 'required' },
  GP_DEV_MACHINE_SECRET: { tier: 'required' },
  GP_ORG_ID_DEV: { tier: 'required' },

  // --- Optional: everything else ---------------------------------------
  // Sign-in redirect — read directly by @clerk/nextjs, not a literal
  // `process.env.X` in our own code. Sign-up is disabled (invite-only).
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: { tier: 'optional' },
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: { tier: 'optional' },

  GP_API_PORT: { tier: 'optional' },
  GP_API_ROOT_PATH: { tier: 'optional' },
  GP_PROD_API_DOMAIN: { tier: 'optional' },
  GP_PROD_MACHINE_SECRET: { tier: 'optional' },
  GP_ORG_ID_PROD: { tier: 'optional' },

  // Impersonation-redirect targets, one per GP environment
  // (src/app/dashboard/users/actions.ts, .../briefings/actions.ts).
  NEXT_PUBLIC_GP_DEV_WEBAPP_URL: { tier: 'optional' },
  NEXT_PUBLIC_GP_WEBAPP_URL: { tier: 'optional' },

  // Ships dark until set on the Vercel project (src/sentry.server.config.ts,
  // src/instrumentation-client.ts).
  NEXT_PUBLIC_SENTRY_DSN: { tier: 'optional' },

  // Opts the outreach-results dashboard into sample data while gp-api's
  // real endpoints don't exist yet.
  OUTREACH_RESULTS_FIXTURES: { tier: 'optional' },

  BASE_URL: { tier: 'optional' },
  CI: { tier: 'optional' },
  NEXT_RUNTIME: { tier: 'optional' },

  // E2E test-user credentials, resolved by TEST_USER_ENV_MAP in
  // e2e/helpers/auth.ts — a `process.env[key]` indirection a plain grep for
  // the literal `process.env.X` misses.
  CLERK_TEST_DEV_ADMIN_EMAIL: { tier: 'optional' },
  CLERK_TEST_DEV_ADMIN_PASSWORD: { tier: 'optional' },
  CLERK_TEST_DEV_SALES_EMAIL: { tier: 'optional' },
  CLERK_TEST_DEV_SALES_PASSWORD: { tier: 'optional' },
  CLERK_TEST_DEV_READONLY_EMAIL: { tier: 'optional' },
  CLERK_TEST_DEV_READONLY_PASSWORD: { tier: 'optional' },
  CLERK_TEST_PROD_ADMIN_EMAIL: { tier: 'optional' },
  CLERK_TEST_PROD_ADMIN_PASSWORD: { tier: 'optional' },
  CLERK_TEST_PROD_SALES_EMAIL: { tier: 'optional' },
  CLERK_TEST_PROD_SALES_PASSWORD: { tier: 'optional' },
  CLERK_TEST_PROD_READONLY_EMAIL: { tier: 'optional' },
  CLERK_TEST_PROD_READONLY_PASSWORD: { tier: 'optional' },
  CLERK_TEST_MULTI_ORG_EMAIL: { tier: 'optional' },
  CLERK_TEST_MULTI_ORG_PASSWORD: { tier: 'optional' },
}

export const envSchema = z.object(
  Object.fromEntries(
    Object.entries(ENV_VAR_CONTRACT).map(([name, spec]) => [
      name,
      spec.tier === 'required' ? z.string().min(1) : z.string().optional(),
    ])
  )
)

export type EnvContract = z.infer<typeof envSchema>
