import { PinoLogger } from 'nestjs-pino'
import { vendorBaseUrl, VENDOR_MODE } from '@/shared/util/appEnvironment.util'

export const S2W_API_BASE_URL = 'https://shared.app-api.scaletowin.com/api/v1'
const S2W_HTTP_TIMEOUT_MS = 30000

export const S2W_MOCK_API_KEY_ID = 'mock-key-id'
export const S2W_MOCK_API_KEY_SECRET = 'mock-key-secret'
export const S2W_MOCK_SUBACCOUNT_ID = 'mock-subaccount'

export type ScaleToWinCredentials = { username: string; password: string }

export class ScaleToWinBaseConfig {
  readonly baseUrl = vendorBaseUrl('scaleToWin', S2W_API_BASE_URL)
  readonly httpTimeoutMs = S2W_HTTP_TIMEOUT_MS

  constructor(protected readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
  }

  // Asserted at first use, not import: only prod holds these keys, so dev and
  // preview must still boot without them.
  get credentials(): ScaleToWinCredentials {
    if (VENDOR_MODE === 'mock') {
      return {
        username: S2W_MOCK_API_KEY_ID,
        password: S2W_MOCK_API_KEY_SECRET,
      }
    }
    const { S2W_API_KEY_ID, S2W_API_KEY_SECRET } = process.env
    if (!S2W_API_KEY_ID || !S2W_API_KEY_SECRET) {
      throw new Error('Missing S2W_API_KEY_ID or S2W_API_KEY_SECRET config')
    }
    return { username: S2W_API_KEY_ID, password: S2W_API_KEY_SECRET }
  }

  get subaccountId(): string {
    if (VENDOR_MODE === 'mock') return S2W_MOCK_SUBACCOUNT_ID
    const { S2W_SUBACCOUNT_ID } = process.env
    if (!S2W_SUBACCOUNT_ID) {
      throw new Error('Missing S2W_SUBACCOUNT_ID config')
    }
    return S2W_SUBACCOUNT_ID
  }
}
