// Fetches per-package local .env values from gp-api's device-flow vending
// endpoint (POST /v1/dev-env/bundle — packages/gp-api/src/devEnv) and
// validates the response shape before anything downstream trusts it.
//
// The contract's enum on `package` (not a bare string) is load-bearing:
// the value feeds a file path in cli.ts (`device-${bundle.package}.env`),
// and the enum is what stops a malformed/unexpected response value from
// becoming a path-traversal write. cli.ts also cross-checks each bundle's
// package against what was actually requested before writing anything.
import {
  DevEnvBundleResponseSchema,
  type DevEnvPackageBundle,
} from '@goodparty_org/contracts'

const FETCH_TIMEOUT_MS = 10_000

export type { DevEnvPackageBundle }

type FetchLike = typeof fetch

export class DevEnvBundleFetchError extends Error {}

export const fetchDevEnvBundles = async (
  apiUrl: string,
  token: string,
  packages: string[],
  fetchImpl: FetchLike = fetch,
): Promise<DevEnvPackageBundle[]> => {
  let response: Response
  try {
    response = await fetchImpl(new URL('/v1/dev-env/bundle', apiUrl), {
      method: 'POST',
      headers: {
        // Dedicated header: gp-api's global SessionGuard 401s any
        // Authorization bearer that is not a Clerk token, even on public
        // routes, before the GitHub membership guard can run.
        'X-GitHub-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ packages }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new DevEnvBundleFetchError(
      `Could not reach ${apiUrl} (${(err as Error).message}).`,
    )
  }

  if (response.status === 503) {
    throw new DevEnvBundleFetchError(
      `${apiUrl} has dev env vending configured off (503).`,
    )
  }
  if (response.status === 401) {
    throw new DevEnvBundleFetchError(
      `${apiUrl} rejected the GitHub token (401) — the token was invalid ` +
        'or expired; re-run setup to go through the device flow again.',
    )
  }
  if (response.status === 403) {
    throw new DevEnvBundleFetchError(
      `${apiUrl} refused the request (403) — confirm you are an active ` +
        'member of the thegoodparty GitHub org.',
    )
  }
  if (!response.ok) {
    throw new DevEnvBundleFetchError(
      `${apiUrl} returned ${response.status} fetching the dev env bundle.`,
    )
  }

  const json = await response.json().catch(() => null)
  const parsed = DevEnvBundleResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new DevEnvBundleFetchError(
      'Dev env bundle response had an unexpected shape.',
    )
  }
  return parsed.data.bundles
}
