import type { FetchOptions } from 'ofetch'
import type { HttpClient, OfetchRequestBody } from '../http/HttpClient'

export abstract class BaseResource {
  protected httpClient: HttpClient
  protected abstract readonly resourceBasePath: string

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

  protected patchRequest = <T>(
    path: string,
    body: OfetchRequestBody,
  ): Promise<T> => this.httpClient.request<T>(path, { method: 'PATCH', body })

  // A body is optional but sometimes required: gp-api keys some deletes on a
  // payload rather than a path param, because the subject is an identifier
  // from another service with no resource URL of its own.
  protected deleteRequest = <T>(
    path: string,
    body?: OfetchRequestBody,
  ): Promise<T> => this.httpClient.request<T>(path, { method: 'DELETE', body })
}
