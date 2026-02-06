import { ofetch, FetchError, FetchOptions } from 'ofetch'
import { SdkError } from '../types/result'

export type OfetchRequestBody = FetchOptions<'json'>['body']

export class HttpClient {
  private baseUrl: string
  private m2mToken: string

  constructor(gpApiRootUrl: string, m2mToken: string) {
    this.baseUrl = gpApiRootUrl
    this.m2mToken = m2mToken
  }

  request = async <T>(
    path: string,
    init?: FetchOptions<'json'>,
  ): Promise<T> => {
    try {
      return await ofetch<T>(path, {
        baseURL: this.baseUrl,
        headers: {
          Authorization: `Bearer ${this.m2mToken}`,
          ...(init?.headers ?? {}),
        },
        ...init,
      })
    } catch (error: unknown) {
      if (error instanceof FetchError) {
        throw new SdkError(error.statusCode ?? 0, error.message, error.response)
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new SdkError(0, message)
    }
  }
}
