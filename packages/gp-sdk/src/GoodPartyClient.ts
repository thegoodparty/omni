export type GoodPartyClientConfig = Record<string, never>

export class GoodPartyClient {
  constructor(_config?: GoodPartyClientConfig) {
    console.log('hello world!')
  }
}
