import type { FetchOptions } from 'ofetch'
import type { HttpClient, OfetchRequestBody } from '../http/HttpClient'

export abstract class BaseResource {
  protected httpClient: HttpClient

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient
  }

  protected getRequest = <T>(
    path: string,
    query?: FetchOptions<'json'>['query'],
  ): Promise<T> => this.httpClient.request<T>(path, { method: 'GET', query })

  protected postRequest = <T>(
    path: string,
    body: OfetchRequestBody,
  ): Promise<T> => this.httpClient.request<T>(path, { method: 'POST', body })

  protected putRequest = <T>(
    path: string,
    body: OfetchRequestBody,
  ): Promise<T> => this.httpClient.request<T>(path, { method: 'PUT', body })

  protected deleteRequest = <T>(path: string): Promise<T> =>
    this.httpClient.request<T>(path, { method: 'DELETE' })
}
