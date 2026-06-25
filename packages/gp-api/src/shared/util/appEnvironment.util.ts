import { requireEnv, getEnv } from 'src/shared/util/env.util'

enum AppEnv {
  PROD = 'production',
  DEV = 'development',
  QA = 'qa',
  LOCAL = 'local',
}
const CURRENT_ENV = process.env.NODE_ENV

// Set per-deploy in deploy/index.ts as one of 'preview' | 'dev' | 'qa' | 'prod'.
// This is the only env signal that reliably distinguishes a prod deploy from a
// non-prod deploy (NODE_ENV is pinned to 'production' in every Docker build —
// see the IS_PROD caution below).
export const OTEL_SERVICE_ENVIRONMENT = process.env.OTEL_SERVICE_ENVIRONMENT
export const IS_PROD_DEPLOY = OTEL_SERVICE_ENVIRONMENT === 'prod'

// Canonical prod user-facing app origin. In prod the webapp (Clerk-protected
// app routes such as /serve/welcome, /reset-password, /set-password) is served
// at app.goodparty.org, while WEBAPP_ROOT_URL is the MARKETING origin
// (https://goodparty.org) where those app routes 404. Prod therefore must NOT
// derive its app origin from WEBAPP_ROOT_URL.
const PROD_APP_ROOT = 'https://app.goodparty.org' as const

// User-facing app origin used to build links handed/emailed to users
// (magic-link, password reset, password set). Resolution order:
//   1. APP_ROOT_URL — explicit override (local .env / .env.test); always wins.
//   2. Non-prod deploys — WEBAPP_ROOT_URL, the per-env webapp origin the infra
//      already sets (https://dev.goodparty.org, https://qa.goodparty.org). That
//      is the host able to redeem env-scoped Clerk tickets. APP_ROOT_URL is
//      never set in any deployed env, so previously non-prod fell through to the
//      prod default below and dev/qa links pointed at the prod app — a
//      dev-instance Clerk ticket opened on the prod host bounces to /login.
//   3. Prod deploys (and the final safety fallback) — PROD_APP_ROOT, kept
//      explicit because prod's WEBAPP_ROOT_URL is the marketing origin (see
//      above), so deriving prod from it would 404 every app link.
//
// Pure (env-free) so it can be unit-tested without module-reset gymnastics.
export function resolveAppRoot({
  appRootUrl,
  webappRootUrl,
  isProdDeploy,
}: {
  appRootUrl?: string
  webappRootUrl?: string
  isProdDeploy: boolean
}): string {
  return (
    appRootUrl ||
    (isProdDeploy ? PROD_APP_ROOT : webappRootUrl) ||
    PROD_APP_ROOT
  )
}

export const APP_ROOT = resolveAppRoot({
  appRootUrl: getEnv('APP_ROOT_URL'),
  webappRootUrl: getEnv('WEBAPP_ROOT_URL'),
  isProdDeploy: IS_PROD_DEPLOY,
})
export const WEBAPP_ROOT = requireEnv('WEBAPP_ROOT_URL') // marketing site
export const ASSET_DOMAIN = requireEnv('ASSET_DOMAIN')
export const WEBAPP_API_PATH = '/api/v1/'

// CAUTION: IS_PROD is true in EVERY Docker-built deploy (preview/dev/qa/prod)
// because deploy/Dockerfile pins NODE_ENV=production for runtime performance.
// IS_PROD therefore only reliably distinguishes LOCAL vs DEPLOYED — not
// prod-deploy vs non-prod-deploy. For routing that needs to differ between
// actual deploys (Slack channels, telemetry env tags, prod-only data filters),
// use IS_PROD_DEPLOY or OTEL_SERVICE_ENVIRONMENT above.
export const IS_PROD = isEnvironment(AppEnv.PROD)
export const IS_DEV = isEnvironment(AppEnv.DEV)

function isEnvironment(env: AppEnv) {
  return CURRENT_ENV === env
}

// NODE_ENV is string | undefined — cannot constrain to AppEnv union without runtime check
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const CURRENT_ENVIRONMENT = CURRENT_ENV as AppEnv
