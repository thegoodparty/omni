import { auth } from '@clerk/nextjs/server'
import { GoodPartyClient } from '@goodparty_org/sdk'
import {
  type GpEnvironment,
  getEnvironmentConfig,
  resolveEnvironment,
} from '@/shared/util/gpEnvironment'

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
