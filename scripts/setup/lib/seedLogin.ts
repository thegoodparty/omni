// Best-effort helper behind `scripts/setup.sh`'s final step: mints a per-run
// Clerk M2M token with a dedicated local-setup machine, then uses it to mint
// a QA fixture user via gp-api's AdminOrM2MGuard-protected test-fixtures
// endpoint (packages/gp-api/src/testFixtures/), so bootstrap ends with a
// browser-ready login instead of just a healthy stack.
//
// Pure HTTP calls behind an injectable fetch, so the mint/call/skip paths
// are unit-testable without a real Clerk instance or a running gp-api.
// Response bodies carry credentials by contract (see testFixtures/AGENTS.md)
// — never log one; only the fields deliberately returned here (email,
// password) ever leave this module, and only as data, never via console.

const CLERK_M2M_TOKENS_URL = 'https://api.clerk.com/v1/m2m_tokens'
const GP_API_BASE_URL = 'http://localhost:3000'
// Clerk caps M2M token TTL at 3600s regardless of what's requested (even
// null), so there's no reason to ask for less. Mint fresh every run rather
// than caching — setup.sh's login step runs once per bootstrap, not in a
// hot path.
const TOKEN_TTL_SECONDS = 3600

export type FetchImpl = typeof fetch

export type SeedLoginResult =
  | { kind: 'skipped'; reason: string }
  | { kind: 'minted'; email: string; password: string }
  | { kind: 'failed'; reason: string }

const mintM2MToken = async (
  machineSecret: string,
  fetchImpl: FetchImpl,
): Promise<string> => {
  const res = await fetchImpl(CLERK_M2M_TOKENS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${machineSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ seconds_until_expiration: TOKEN_TTL_SECONDS }),
  })
  // 201, not 200 — see testFixtures/AGENTS.md-adjacent gotchas in the ticket.
  if (res.status !== 201) {
    throw new Error(`Clerk M2M token mint failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { token?: string }
  if (!body.token) {
    throw new Error('Clerk M2M token mint returned no token')
  }
  return body.token
}

const mintFixtureUser = async (
  m2mToken: string,
  userState: string,
  fetchImpl: FetchImpl,
): Promise<{ email: string; password: string }> => {
  const res = await fetchImpl(`${GP_API_BASE_URL}/v1/test-fixtures/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${m2mToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state: userState }),
  })
  if (res.status !== 201) {
    throw new Error(`test-fixtures/users failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { email?: string; password?: string }
  if (!body.email || !body.password) {
    throw new Error('test-fixtures/users response missing email/password')
  }
  return { email: body.email, password: body.password }
}

// Orchestrates the skip/mint/fail paths setup.sh's final step needs. A
// missing machine secret is an ops prerequisite gap (the Clerk machine isn't
// provisioned yet), not a bug — skip cleanly rather than throwing, so a
// caller under `set -euo pipefail` never has to special-case this path.
export const runSeedLogin = async (
  machineSecret: string,
  userState: string,
  fetchImpl: FetchImpl = fetch,
): Promise<SeedLoginResult> => {
  if (!machineSecret) {
    return {
      kind: 'skipped',
      reason: 'LOCAL_SETUP_CLERK_MACHINE_SECRET not set',
    }
  }
  try {
    const m2mToken = await mintM2MToken(machineSecret, fetchImpl)
    const { email, password } = await mintFixtureUser(
      m2mToken,
      userState,
      fetchImpl,
    )
    return { kind: 'minted', email, password }
  } catch (error) {
    return {
      kind: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
