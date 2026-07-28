import { ofetch, FetchError, FetchOptions } from 'ofetch'
import { SdkError } from '../types/result'

export type OfetchRequestBody = FetchOptions<'json'>['body']

export class HttpClient {
  private baseUrl: string
  private getToken: () => Promise<string>

  constructor(gpApiRootUrl: string, getToken: () => Promise<string>) {
    this.baseUrl = gpApiRootUrl
    this.getToken = getToken
  }

  request = async <T>(
    path: string,
    init?: FetchOptions<'json'>,
  ): Promise<T> => {
    try {
      return await ofetch<T>(path, {
        ...init,
        // baseURL after ...init so a caller-supplied init.baseURL can't
        // override the configured API root.
        baseURL: this.baseUrl,
        // headers last, with Authorization after the caller's headers so the
        // managed Bearer token always wins while other caller headers merge.
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${await this.getToken()}`,
        },
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
