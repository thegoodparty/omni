import { cookies } from 'next/headers'
import {
  ExperimentVariantsSchema,
  type ExperimentVariants,
} from '@goodparty_org/contracts'

// E2E-only override seam. Flag resolution is server-side (gp-api → Amplitude)
// and the browser never fetches Amplitude, so a Playwright test can't stub a
// variant. Instead the e2e auth helper writes this cookie and the server-side
// resolver merges it over gp-api's result, making flag-gated surfaces
// deterministic without depending on live Amplitude targeting for synthetic
// @test.goodparty.org users.
//
// Safety: disabled on production via VERCEL_ENV — Vercel's reserved runtime
// system var (production | preview | development), always present server-side,
// and NOT the NEXT_PUBLIC_VERCEL_TARGET_ENV that isn't reliably populated here.
// Read only from a cookie (never a query param) and schema-validated. Feature
// flags gate UX, not authorization (gp-api still enforces authz), so the blast
// radius is the requester's own gated UI on a non-prod environment.
//
// Kept in sync with the cookie name hardcoded in the e2e helper
// (e2e-tests/src/helpers/campaignStory.helper.ts) — that workspace can't import
// from app/ (separate tsconfig, no Next runtime).
export const FLAG_OVERRIDE_COOKIE = 'e2e-flag-overrides'

export async function getFlagOverrides(): Promise<ExperimentVariants | null> {
  if (process.env.VERCEL_ENV === 'production') return null

  const raw = (await cookies()).get(FLAG_OVERRIDE_COOKIE)?.value
  if (!raw) return null

  try {
    const parsed = ExperimentVariantsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
