import { auth } from '@clerk/nextjs/server'
import { GoodPartyClient } from '@goodparty_org/sdk'
import {
  type GpEnvironment,
  getEnvironmentConfig,
  resolveEnvironment,
} from '@/shared/util/gpEnvironment'

const clientCache = new Map<GpEnvironment, Promise<GoodPartyClient>>()

async function getOrCreateGpClient(
  environment: GpEnvironment
): Promise<GoodPartyClient> {
  const cached = clientCache.get(environment)
  if (cached) return cached

  const clientPromise = GoodPartyClient.create(
    getEnvironmentConfig(environment)
  )
  clientCache.set(environment, clientPromise)

  try {
    return await clientPromise
  } catch (err) {
    clientCache.delete(environment)
    throw err
  }
}

export async function gpAction<T>(
  fn: (client: GoodPartyClient) => Promise<T>
): Promise<T> {
  const { orgId } = await auth()

  if (!orgId) {
    throw new Error('No active organization')
  }

  const environment = resolveEnvironment(orgId)
  const client = await getOrCreateGpClient(environment)
  return fn(client)
}
