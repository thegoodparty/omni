import { PinoLogger } from 'nestjs-pino'

// The generic https://api.callhub.io host is deprecated and 403s; accounts are
// pinned to a regional host (ours is https://api-na1.callhub.io). Keep the
// region in config, not hardcoded, so a different account can point elsewhere.
const {
  CALLHUB_API_KEY,
  CALLHUB_API_BASE_URL = 'https://api-na1.callhub.io',
  CALLHUB_HTTP_TIMEOUT = '30000',
} = process.env

export class CallhubBaseConfig {
  readonly baseUrl = CALLHUB_API_BASE_URL
  readonly httpTimeoutMs = parseInt(CALLHUB_HTTP_TIMEOUT, 10)

  constructor(protected readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
  }

  // Asserted at first use, not import: an import-time throw took down every
  // boot in environments without the key (dev ECS and PR previews) the moment
  // OutreachModule wired CallhubModule in. Missing config must break the
  // CallHub endpoints, never app startup.
  get apiKey(): string {
    if (!CALLHUB_API_KEY) {
      throw new Error('Missing CALLHUB_API_KEY config')
    }
    return CALLHUB_API_KEY
  }
}
