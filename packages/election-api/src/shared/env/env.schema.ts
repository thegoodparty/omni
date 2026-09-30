import { z } from 'zod'

// The single source of truth for "what env vars does election-api read".
// Every name here is grepped straight from `process.env` reads under `src/`
// and reconciled against `.env.example`. Bare Node import only: no Nest, no
// Prisma, so this can be required from a plain script or a CI check.
//
// Tiers describe what SHOULD gate boot, not what does today.
//
// - required    — boot should fail fast without it.
// - degradable  — missing/placeholder disables one named feature surface.
// - optional    — a setting, tunable, or vendor key with no boot dependency.
//
// election-api is not part of the local bootstrap flow gp-api/gp-webapp/
// gp-admin share — this contract exists purely for CI drift protection
// between env.schema.ts and .env.example.
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
  DATABASE_URL: { tier: 'required' },
  CORS_ORIGIN: { tier: 'required' },

  // --- Optional: everything else ---------------------------------------
  NODE_ENV: { tier: 'optional' },
  LOG_LEVEL: { tier: 'optional', default: 'debug' },
  HOST: { tier: 'optional', default: 'localhost' },
  PORT: { tier: 'optional', default: '3000' },
  CI: { tier: 'optional' },

  // Clerk M2M authentication. election-api is the recipient/verifier: it
  // verifies incoming `mt_*` tokens against its own machine secret. Callers
  // (gp-api, gp-marketing) mint tokens with their own machine secrets and
  // must be connected to the election-api machine in the Clerk dashboard.
  CLERK_SECRET_KEY: { tier: 'optional' },
  CLERK_PUBLISHABLE_KEY: { tier: 'optional' },
  ELECTION_API_MACHINE_SECRET: { tier: 'optional' },

  // Set per-deploy by deploy/index.ts to 'preview' | 'dev' | 'prod'.
  OTEL_SERVICE_ENVIRONMENT: { tier: 'optional', default: 'local' },
  OTEL_EXPORTER_OTLP_HEADERS: { tier: 'optional' },

  // Overrides for src/prisma/prisma.service.ts's connection pool sizing.
  PRISMA_CONNECTION_LIMIT: { tier: 'optional', default: '10' },
  PRISMA_POOL_TIMEOUT: { tier: 'optional', default: '20' },

  // src/zipToPosition/zipToPosition.service.ts's district/zip match
  // threshold.
  PCT_DISTRICTZIP_TO_ZIP_THRESHOLD: { tier: 'optional', default: '0.005' },
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
