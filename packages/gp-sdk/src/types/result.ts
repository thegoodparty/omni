export class SdkError extends Error {
  readonly status: number
  readonly response?: Response
  /** Parsed error-response body (e.g. gp-api's Zod validation details). */
  readonly body?: unknown

  constructor(
    status: number,
    message: string,
    response?: Response,
    body?: unknown,
  ) {
    super(message)
    this.name = 'SdkError'
    this.status = status
    this.response = response
    this.body = body
  }
}
