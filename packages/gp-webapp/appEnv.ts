export const IS_PROD =
  process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV === 'production'
export const IS_PREVIEW =
  process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV === 'preview'
export const IS_DEV =
  process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV === 'development'
export const IS_LOCAL =
  Boolean(
    typeof process !== 'undefined' &&
    process?.env?.NEXT_PUBLIC_API_BASE?.includes('localhost'),
  ) ||
  Boolean(
    typeof window !== 'undefined' && window.location.href.includes('localhost'),
  )

export const API_ROOT =
  process.env.NEXT_PUBLIC_API_BASE || 'https://gp-api-dev.goodparty.org'

export const ELECTION_API_ROOT =
  process.env.NEXT_PUBLIC_ELECTION_API_BASE ||
  'https://election-api-dev.goodparty.org'

export const API_VERSION_PREFIX = '/v1'

// Public/canonical base. In prod this is the MARKETING origin
// (goodparty.org), which is what `metadataBase` in app/layout.tsx wants for
// canonical + OG tags. It is NOT the origin this app is served from — see
// APP_SHARE_BASE below before using it to build a link to one of our routes.
export const APP_BASE = IS_LOCAL
  ? 'http://localhost:4000'
  : `https://${
      IS_PROD
        ? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
        : process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL
    }`

// Prod is hardcoded rather than derived because prod's marketing origin
// (APP_BASE) is a different deployment with no /api/* proxy, so there is
// nothing to derive it from. Mirrors PROD_APP_ROOT in gp-api's
// shared/util/appEnvironment.util.ts, which exists for the same reason.
const PROD_APP_SHARE_BASE = 'https://app.goodparty.org'

// Origin this app is actually served from — use it for any URL that must
// resolve back to one of our own routes, especially links handed to a
// recipient (the public briefing share URL, whose /api/v1/* path middleware
// proxies to gp-api). Deliberately has no env override: the obvious candidate,
// NEXT_PUBLIC_APP_BASE, is documented in .env.example as the marketing origin,
// so honoring it would silently reintroduce the 404 this constant exists to
// prevent.
export const APP_SHARE_BASE = IS_LOCAL
  ? 'http://localhost:4000'
  : IS_PROD
    ? PROD_APP_SHARE_BASE
    : `https://${process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL}`

export const NEXT_PUBLIC_AMPLITUDE_API_KEY =
  process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY

export const NEXT_PUBLIC_SEGMENT_WRITE_KEY =
  process.env.NEXT_PUBLIC_SEGMENT_WRITE_KEY

export const NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  'pk_test_51P8p2Y1taBPnTqn4IacUdFzw2mWPe8ljraPrpMlqMxtb8h1EvYTJvdGrj3kSeRIqm2ltL8RE8bAZL3EsLqpW3VNS00VZLcvudS'

export const NEXT_PUBLIC_GOOGLE_MAPS_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ||
  'AIzaSyDMcCbNUtBDnVRnoLClNHQ8hVDILY52ez8'

// Domain-restricted tiles-only key (separate from gp-api's server-side
// routing key — never expose that one).
export const NEXT_PUBLIC_GEOAPIFY_TILES_KEY =
  process.env.NEXT_PUBLIC_GEOAPIFY_TILES_KEY || ''

export const NEXT_PUBLIC_CANDIDATES_SITE_BASE =
  process.env.NEXT_PUBLIC_CANDIDATES_SITE_BASE ||
  (IS_LOCAL ? 'http://localhost:4001' : 'https://candidates.goodparty.org')

export const NEXT_PUBLIC_P2P_CUTOFF_DATETIME =
  process.env.NEXT_PUBLIC_P2P_CUTOFF_DATETIME

export const MARKETING_SITE_DOMAIN =
  process.env.NEXT_PUBLIC_MARKETING_SITE_DOMAIN || 'goodparty.org'

export const CIRCLE_COMMUNITY_BASE = IS_PROD
  ? 'https://goodpartyorg.circle.so'
  : 'https://goodpartyorg-sandbox-community.circle.so'

// Clerk Authentication
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are read directly by @clerk/nextjs
// Sign-in/sign-up URLs are configured via NEXT_PUBLIC_CLERK_* env vars (see .env.example)
