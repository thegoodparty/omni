import { PinoLogger } from 'nestjs-pino'

const {
  CALLFIRE_LOGIN,
  CALLFIRE_PASSWORD,
  CALLFIRE_API_BASE_URL = 'https://api.callfire.com/v2',
  CALLFIRE_HTTP_TIMEOUT = '30000',
} = process.env

export class CallfireBaseConfig {
  readonly baseUrl = CALLFIRE_API_BASE_URL
  readonly httpTimeoutMs = parseInt(CALLFIRE_HTTP_TIMEOUT, 10)

  constructor(protected readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
  }

  // Asserted at first use, not import: an import-time throw would take down
  // every boot in environments without the credentials (dev ECS and PR
  // previews) the moment the module is wired in. Missing config must break the
  // CallFire endpoints, never app startup — mirrors CallHub's lazy pattern.
  get apiLogin(): string {
    if (!CALLFIRE_LOGIN) {
      throw new Error('Missing CALLFIRE_LOGIN config')
    }
    return CALLFIRE_LOGIN
  }

  get apiPassword(): string {
    if (!CALLFIRE_PASSWORD) {
      throw new Error('Missing CALLFIRE_PASSWORD config')
    }
    return CALLFIRE_PASSWORD
  }
}
