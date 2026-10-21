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
  DevEnvElectionSeedResponseSchema,
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

// The local election seed (POST /v1/dev-env/election-seed): a presigned URL
// for the slice of the dev election database `electiondb` is loaded from.
// Same gate and header as the bundle above. The URL is a bearer credential
// for a restricted dataset until it expires — never print it.
export const fetchElectionSeedUrl = async (
  apiUrl: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> => {
  let response: Response
  try {
    response = await fetchImpl(new URL('/v1/dev-env/election-seed', apiUrl), {
      method: 'POST',
      headers: {
        'X-GitHub-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new DevEnvBundleFetchError(
      `Could not reach ${apiUrl} (${(err as Error).message}).`,
    )
  }

  if (response.status === 503) {
    throw new DevEnvBundleFetchError(
      `${apiUrl} has no local election seed available (503).`,
    )
  }
  if (!response.ok) {
    throw new DevEnvBundleFetchError(
      `${apiUrl} returned ${response.status} fetching the election seed URL.`,
    )
  }

  const json = await response.json().catch(() => null)
  const parsed = DevEnvElectionSeedResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new DevEnvBundleFetchError(
      'Election seed response had an unexpected shape.',
    )
  }
  return parsed.data.url
}

// Streams the seed to disk, writing to a sibling temp file and renaming so an
// interrupted download never leaves a truncated seed that a later load would
// half-apply.
export const downloadElectionSeed = async (
  url: string,
  outPath: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> => {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(10 * 60_000),
  })
  if (!response.ok || !response.body) {
    throw new DevEnvBundleFetchError(
      `Downloading the election seed failed (${response.status}).`,
    )
  }
  const { createWriteStream } = await import('fs')
  const { rename, mkdir } = await import('fs/promises')
  const { dirname } = await import('path')
  const { Readable } = await import('stream')
  const { pipeline } = await import('stream/promises')
  await mkdir(dirname(outPath), { recursive: true })
  const partial = `${outPath}.partial`
  await pipeline(
    Readable.fromWeb(response.body as import('stream/web').ReadableStream),
    createWriteStream(partial),
  )
  await rename(partial, outPath)
}
