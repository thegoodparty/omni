// GitHub OAuth device-flow (RFC 8628) client behind `scripts/setup.sh`'s
// secrets step. No fs/process access here on purpose (mirrors env.ts) —
// keeps this unit-testable with a fake fetch/sleep instead of a live GitHub
// flow. cli.ts owns the fs writes and process-level concerns (stdout,
// `open`, exit codes).
//
// read:org is the only scope this ever requests: the vending endpoint
// (packages/gp-api/src/devEnv) gates purely on active thegoodparty org
// membership, and there is deliberately no token caching — a fresh flow
// runs every time `scripts/setup.sh` needs one.

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
export const DEVICE_FLOW_SCOPE = 'read:org'

// A hung connection must not hang the whole bootstrap script forever;
// mirrors GithubOrgMemberGuard's own timeout on the same host.
const FETCH_TIMEOUT_MS = 10_000

// GitHub's documented bump when a `slow_down` response omits its own
// `interval` field.
const SLOW_DOWN_INCREMENT_SECONDS = 5

export type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export class AccessDeniedError extends Error {
  constructor() {
    super('GitHub authorization was denied.')
  }
}

export class DeviceFlowExpiredError extends Error {
  constructor() {
    super('The GitHub device code expired before it was authorized.')
  }
}

type FetchLike = typeof fetch

const postJson = async (
  url: string,
  body: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  return { ok: response.ok, data }
}

export const requestDeviceCode = async (
  clientId: string,
  fetchImpl: FetchLike = fetch,
): Promise<DeviceCodeResponse> => {
  const { ok, data } = await postJson(
    DEVICE_CODE_URL,
    { client_id: clientId, scope: DEVICE_FLOW_SCOPE },
    fetchImpl,
  )
  const { device_code, user_code, verification_uri, expires_in, interval } =
    data
  if (
    !ok ||
    typeof device_code !== 'string' ||
    typeof user_code !== 'string' ||
    typeof verification_uri !== 'string' ||
    typeof expires_in !== 'number' ||
    typeof interval !== 'number'
  ) {
    throw new Error(
      'GitHub did not return a device code (unreachable, or client_id is invalid).',
    )
  }
  return { device_code, user_code, verification_uri, expires_in, interval }
}

type PollResult =
  | { status: 'success'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down'; intervalSeconds?: number }

export const pollAccessTokenOnce = async (
  clientId: string,
  deviceCode: string,
  fetchImpl: FetchLike = fetch,
): Promise<PollResult> => {
  const { data } = await postJson(
    ACCESS_TOKEN_URL,
    { client_id: clientId, device_code: deviceCode, grant_type: GRANT_TYPE },
    fetchImpl,
  )

  if (typeof data.access_token === 'string') {
    return { status: 'success', token: data.access_token }
  }

  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      return {
        status: 'slow_down',
        intervalSeconds:
          typeof data.interval === 'number' ? data.interval : undefined,
      }
    case 'expired_token':
      throw new DeviceFlowExpiredError()
    case 'access_denied':
      throw new AccessDeniedError()
    default:
      throw new Error(
        `GitHub token exchange failed unexpectedly (${String(data.error ?? 'no token, no error')}).`,
      )
  }
}

export type AwaitAccessTokenDeps = {
  fetchImpl?: FetchLike
  sleep: (ms: number) => Promise<void>
}

// Polls at device.interval, honoring `slow_down` by growing it, until
// success or a thrown expired/denied. The caller (cli.ts) fails closed on
// either throw and tells the human to re-run for a fresh code — the only
// "restart" this flow offers, deliberately: no token caching, so a stale
// device_code is worthless anyway.
export const awaitAccessToken = async (
  clientId: string,
  device: DeviceCodeResponse,
  { fetchImpl = fetch, sleep }: AwaitAccessTokenDeps,
): Promise<string> => {
  let intervalSeconds = device.interval
  for (;;) {
    await sleep(intervalSeconds * 1000)
    const result = await pollAccessTokenOnce(
      clientId,
      device.device_code,
      fetchImpl,
    )
    if (result.status === 'success') return result.token
    if (result.status === 'slow_down') {
      intervalSeconds =
        result.intervalSeconds ?? intervalSeconds + SLOW_DOWN_INCREMENT_SECONDS
    }
    // 'pending' (and a handled 'slow_down') both just loop again.
  }
}
