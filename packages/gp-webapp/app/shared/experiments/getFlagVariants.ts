import { cookies } from 'next/headers'
import { z } from 'zod'
import { serverRequest } from 'gpApi/server-request'
import { getServerToken, isTokenExpired } from 'helpers/tokenHelper'
import { IS_PROD } from 'appEnv'
import type { ExperimentVariants } from '@goodparty_org/contracts'

// Non-prod test/dev seam: a cookie can force Amplitude flag variants so e2e
// tests (and local dev) exercise flag-gated UX deterministically without
// depending on Amplitude's live targeting. The flag only ever reaches the
// browser via the server-resolved seed below, so overriding here is the one
// place that flows through every read (route guards, sidebar, routing).
// Never honored in prod. Cookie value is a JSON map of flag key -> variant
// value, e.g. {"campaign-story":"on"}.
const FLAG_OVERRIDE_COOKIE = 'ff-overrides'
const FlagOverridesSchema = z.record(z.string(), z.string())

async function readFlagOverrides(): Promise<ExperimentVariants | null> {
  if (IS_PROD) return null
  const raw = (await cookies()).get(FLAG_OVERRIDE_COOKIE)?.value
  if (!raw) return null
  try {
    const parsed = FlagOverridesSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    const entries = Object.entries(parsed.data)
    if (entries.length === 0) return null
    // `key` mirrors `value` to match the client SDK's Variant shape (see
    // ExperimentVariants.schema.ts) — the webapp reads `value`.
    return Object.fromEntries(
      entries.map(([flag, value]) => [flag, { value, key: value }]),
    )
  } catch {
    return null
  }
}

// Server-side flag resolution for the current user. gp-api evaluates Amplitude
// Experiment server-to-server, so the result is correct on first paint and
// never depends on the browser reaching Amplitude. Returns null for anonymous
// requests or on any failure, in which case the client SDK fetch takes over.
export async function getFlagVariants(): Promise<ExperimentVariants | null> {
  const overrides = await readFlagOverrides()

  // Mirror fetchUserCampaign: skip the call entirely for unauthenticated
  // requests so bots hammering the app don't generate authed-endpoint traffic.
  let resolved: ExperimentVariants | null = null
  const token = await getServerToken()
  if (token && !isTokenExpired(token)) {
    const result = await serverRequest(
      'GET /v1/experiment/variants',
      {},
      { ignoreResponseError: true },
    )
    if (result.ok) {
      resolved = result.data.variants
    }
  }

  // Overrides win over (and can seed without) server-resolved variants so a
  // non-prod test can force any flag on regardless of Amplitude targeting.
  if (!overrides) return resolved
  return { ...(resolved ?? {}), ...overrides }
}
