export class SdkError extends Error {
  readonly status: number
  readonly response?: Response

  constructor(status: number, message: string, response?: Response) {
    super(message)
    this.name = 'SdkError'
    this.status = status
    this.response = response
  }
}
