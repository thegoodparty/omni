// Fetches per-package local .env values from gp-api's device-flow vending
// endpoint (POST /v1/dev-env/bundle — packages/gp-api/src/devEnv) and
// validates the response shape before anything downstream trusts it.
//
// Mirrors DevEnvBundleResponseSchema from @goodparty_org/contracts (see
// packages/contracts/src/devEnv/devEnv.schema.ts on the vending-endpoint
// branch, PR #2238) rather than importing it: that schema does not exist on
// this bootstrap branch yet (it ships on top of a later main than this
// branch has merged). Swap this for a contracts import once this branch is
// past that merge.
import { z } from 'zod'

const FETCH_TIMEOUT_MS = 10_000

const DevEnvPackageBundleSchema = z.object({
  package: z.string(),
  variables: z.record(z.string(), z.string()),
})

const DevEnvBundleResponseSchema = z.object({
  bundles: z.array(DevEnvPackageBundleSchema),
})

export type DevEnvPackageBundle = z.infer<typeof DevEnvPackageBundleSchema>

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
        Authorization: `Bearer ${token}`,
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
  if (response.status === 401 || response.status === 403) {
    throw new DevEnvBundleFetchError(
      `${apiUrl} rejected the GitHub token (${response.status}) — confirm ` +
        'you are an active member of the thegoodparty GitHub org.',
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
