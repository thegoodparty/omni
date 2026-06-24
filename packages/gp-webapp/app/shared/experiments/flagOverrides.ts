import { cookies } from 'next/headers'
import { IS_LOCAL, IS_PREVIEW } from 'appEnv'
import {
  ExperimentVariantsSchema,
  type ExperimentVariants,
} from '@goodparty_org/contracts'

// E2E-only override seam. Now that flag resolution is server-side (gp-api →
// Amplitude) and the browser never fetches Amplitude, the Playwright suite can
// no longer stub vardata to force a variant. Instead the e2e auth helper writes
// this cookie and the server-side resolver merges it over gp-api's result, so
// flag-gated surfaces are deterministic without coupling tests to live Amplitude
// targeting for synthetic @test.goodparty.org users.
//
// Safety: honored ONLY on ephemeral PR previews and local dev (never dev / qa /
// prod — those have distinct VERCEL_TARGET_ENV values and a non-localhost API),
// read ONLY from a cookie (never a query param), and schema-validated. Feature
// flags gate UX, not authorization (see docs/feature-flags.md), so the blast
// radius is the requesting user's own gated UI on a throwaway environment.
//
// Kept in sync with the cookie name hardcoded in the e2e helper
// (e2e-tests/tests/utils/api-registration.ts) — that workspace can't import from
// app/ (separate tsconfig, no Next runtime).
export const FLAG_OVERRIDE_COOKIE = 'e2e-flag-overrides'

export async function getFlagOverrides(): Promise<ExperimentVariants | null> {
  if (!IS_PREVIEW && !IS_LOCAL) return null

  const raw = (await cookies()).get(FLAG_OVERRIDE_COOKIE)?.value
  if (!raw) return null

  try {
    const parsed = ExperimentVariantsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
