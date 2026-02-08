import { auth } from '@clerk/nextjs/server'
import { GoodPartyClient } from '@goodparty_org/sdk'
import {
  type GpEnvironment,
  getEnvironmentConfig,
  resolveEnvironment,
} from '@/shared/util/gpEnvironment'

export type GpSdkActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

const clientCache = new Map<GpEnvironment, Promise<GoodPartyClient>>()

function getOrCreateGpClient(
  environment: GpEnvironment
): Promise<GoodPartyClient> {
  let clientPromise = clientCache.get(environment)
  if (!clientPromise) {
    const config = getEnvironmentConfig(environment)
    clientPromise = GoodPartyClient.create({
      m2mSecret: config.machineSecret,
      gpApiRootUrl: config.apiRootUrl,
    }).catch((err) => {
      clientCache.delete(environment)
      throw err
    })
    clientCache.set(environment, clientPromise)
  }
  return clientPromise
}

export async function gpSdkAction<T>(
  fn: (client: GoodPartyClient) => Promise<T>
): Promise<GpSdkActionResult<T>> {
  try {
    const { orgId } = await auth()

    if (!orgId) {
      return { success: false, error: 'No active organization' }
    }

    const environment = resolveEnvironment(orgId)
    const client = await getOrCreateGpClient(environment)
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
