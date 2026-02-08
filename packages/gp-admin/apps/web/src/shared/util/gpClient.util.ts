import { GoodPartyClient } from '@goodparty_org/sdk'
import { generateUrl } from '@/shared/util/generateUrl.util'

export type GpActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

let gpClientPromise: Promise<GoodPartyClient> | null = null

function createGpClient(): Promise<GoodPartyClient> {
  const {
    GP_ADMIN_MACHINE_SECRET,
    GP_API_PROTOCOL,
    GP_API_DOMAIN,
    GP_API_PORT,
    GP_API_ROOT_PATH,
  } = process.env

  if (!GP_ADMIN_MACHINE_SECRET) {
    throw new Error('GP_ADMIN_MACHINE_SECRET is not set')
  }

  if (!GP_API_PROTOCOL) {
    throw new Error('GP_API_PROTOCOL is not set')
  }

  if (!GP_API_DOMAIN) {
    throw new Error('GP_API_DOMAIN is not set')
  }

  return GoodPartyClient.create({
    m2mSecret: GP_ADMIN_MACHINE_SECRET,
    gpApiRootUrl: generateUrl({
      protocol: GP_API_PROTOCOL,
      domain: GP_API_DOMAIN,
      port: GP_API_PORT,
      rootPath: GP_API_ROOT_PATH,
    }).toString(),
  })
}

async function getGpClient(): Promise<GoodPartyClient> {
  if (!gpClientPromise) {
    gpClientPromise = createGpClient()
  }
  return gpClientPromise
}

export async function gpAction<T>(
  fn: (client: GoodPartyClient) => Promise<T>
): Promise<GpActionResult<T>> {
  try {
    const client = await getGpClient()
    const data = await fn(client)
    return { success: true, data }
  } catch (error) {
    console.error('GP API error:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'An unexpected error occurred',
    }
  }
}
