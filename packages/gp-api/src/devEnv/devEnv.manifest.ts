import { ENV_VAR_CONTRACT } from '@/shared/env/env.schema'
import { DEV_ENV_PACKAGE_VALUES, DevEnvPackage } from '@goodparty_org/contracts'

// deploy/Dockerfile copies only gp-api's own src plus the prebuilt contracts
// and nest-common packages, so a sibling package's env.schema.ts is not
// resolvable at runtime and cannot be imported here. This mirrors
// packages/gp-webapp/env.schema.ts instead; devEnv.manifest.test.ts parses
// that file and fails the moment the two disagree in either direction.
const GP_WEBAPP_ENV_VAR_NAMES = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'NODE_ENV',
  'NEXT_PUBLIC_VERCEL_TARGET_ENV',
  'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL',
  'NEXT_PUBLIC_VERCEL_BRANCH_URL',
  'VERCEL_ENV',
  'NEXT_RUNTIME',
  'CI',
  'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL',
  'NEXT_PUBLIC_API_BASE',
  'NEXT_PUBLIC_ELECTION_API_BASE',
  'NEXT_PUBLIC_AMPLITUDE_API_KEY',
  'NEXT_PUBLIC_SEGMENT_WRITE_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_GOOGLE_MAPS_KEY',
  'NEXT_PUBLIC_GEOAPIFY_TILES_KEY',
  'NEXT_PUBLIC_CANDIDATES_SITE_BASE',
  'NEXT_PUBLIC_GP_ADMIN_URL',
  'NEXT_PUBLIC_P2P_CUTOFF_DATETIME',
  'NEXT_PUBLIC_MARKETING_SITE_DOMAIN',
  'NEXT_PUBLIC_APP_BASE',
  'NEXT_PUBLIC_SUPPORT_CHAT',
  'NEXT_PUBLIC_DICTATION_DEMO_ENABLED',
  'LOCAL_BRIEFINGS_DIR',
  'LOCAL_ISSUES_DIR',
  'REVALIDATE_SECRET',
  'SENTRY_AUTH_TOKEN',
]

// Every env var name each vendable package declares. The curated
// LOCAL_DEV_ENV secret is the allowlist for what is actually vended; this is
// the sanity check that a blob key is a name the target package will read, so
// a typo in the secret fails the whole fetch instead of shipping a laptop a
// variable nothing reads.
export const DECLARED_ENV_VARS: Record<DevEnvPackage, ReadonlySet<string>> = {
  'gp-api': new Set(Object.keys(ENV_VAR_CONTRACT)),
  'gp-webapp': new Set(GP_WEBAPP_ENV_VAR_NAMES),
  // Read by scripts/mcp/grafana.sh, the launcher .mcp.json starts the
  // Grafana MCP through.
  mcp: new Set(['GRAFANA_SERVICE_ACCOUNT_TOKEN']),
}

export const isDevEnvPackage = (name: string): name is DevEnvPackage =>
  (DEV_ENV_PACKAGE_VALUES as readonly string[]).includes(name)
