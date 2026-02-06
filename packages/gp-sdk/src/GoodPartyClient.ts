import { createClerkClient } from '@clerk/backend'
import { HttpClient } from './http/HttpClient'
import { UsersResource } from './resources/UsersResource'
import { SdkError } from './types/result'

export type GoodPartyClientConfig = {
  m2mSecret: string
  gpApiRootUrl: string
}

export class GoodPartyClient {
  readonly users: UsersResource

  private constructor(gpApiRootUrl: string, m2mToken: string) {
    const httpClient = new HttpClient(gpApiRootUrl, m2mToken)
    this.users = new UsersResource(httpClient)
  }

  static create = async (
    config: GoodPartyClientConfig,
  ): Promise<GoodPartyClient> => {
    const { m2mSecret, gpApiRootUrl } = config
    const clerkClient = createClerkClient({})

    let token: string
    try {
      const m2mToken = await clerkClient.m2m.createToken({
        machineSecretKey: m2mSecret,
      })
      if (!m2mToken.token) {
        throw new SdkError(
          0,
          'Clerk M2M token creation succeeded but returned no token string',
        )
      }
      token = m2mToken.token
    } catch (error: unknown) {
      if (error instanceof SdkError) {
        throw error
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new SdkError(0, `Failed to create Clerk M2M token: ${message}`)
    }

    return new GoodPartyClient(gpApiRootUrl, token)
  }
}
