import { BadRequestException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { resolveEnvVar } from '../../../shared/env/env'
import {
  vendorBaseUrl,
  VENDOR_MODE,
} from '../../../shared/util/appEnvironment.util'

const {
  PEERLY_HTTP_TIMEOUT = '60000', // 60 seconds default
  PEERLY_UPLOAD_TIMEOUT_MS = '60000', // 60 seconds for uploads
  PEERLY_TEST_ENVIRONMENT,
} = process.env

const PEERLY_NOT_CONFIGURED_MESSAGE =
  'Peerly texting is disabled: set PEERLY_API_BASE_URL, PEERLY_MD5_EMAIL, ' +
  'PEERLY_MD5_PASSWORD, and PEERLY_ACCOUNT_NUMBER'

type PeerlyConfig = {
  baseUrl: string
  email: string
  password: string
  accountNumber: string
}

// In mock mode the client talks to our own mock, which accepts any credentials
// on /token-auth. Placeholders keep the client configured on an environment
// whose secrets carry no Peerly keys; real values still win when present.
export const PEERLY_MOCK_EMAIL = 'mock-peerly-email'
export const PEERLY_MOCK_PASSWORD = 'mock-peerly-password'
export const PEERLY_MOCK_ACCOUNT_NUMBER = 'mock-peerly'

const resolvePeerlyConfig = (): PeerlyConfig | null => {
  const baseUrl = resolveEnvVar('PEERLY_API_BASE_URL')
  const email = resolveEnvVar('PEERLY_MD5_EMAIL')
  const password = resolveEnvVar('PEERLY_MD5_PASSWORD')
  const accountNumber = resolveEnvVar('PEERLY_ACCOUNT_NUMBER')
  if (VENDOR_MODE === 'mock') {
    return {
      baseUrl: vendorBaseUrl('peerly', baseUrl.configured ? baseUrl.value : ''),
      email: email.configured ? email.value : PEERLY_MOCK_EMAIL,
      password: password.configured ? password.value : PEERLY_MOCK_PASSWORD,
      accountNumber: accountNumber.configured
        ? accountNumber.value
        : PEERLY_MOCK_ACCOUNT_NUMBER,
    }
  }
  if (
    !baseUrl.configured ||
    !email.configured ||
    !password.configured ||
    !accountNumber.configured
  ) {
    return null
  }
  return {
    baseUrl: vendorBaseUrl('peerly', baseUrl.value),
    email: email.value,
    password: password.value,
    accountNumber: accountNumber.value,
  }
}

const peerlyConfig = resolvePeerlyConfig()

// Every Peerly service subclasses this config, so a shared flag (rather than
// a per-instance one) is what keeps the disabled-boot log to exactly one
// line instead of one per subclass NestJS instantiates.
let hasLoggedPeerlyDisabled = false

export class PeerlyBaseConfig {
  readonly httpTimeoutMs = parseInt(PEERLY_HTTP_TIMEOUT, 10)
  readonly uploadTimeoutMs = parseInt(PEERLY_UPLOAD_TIMEOUT_MS, 10)
  readonly isTestEnvironment = Boolean(PEERLY_TEST_ENVIRONMENT === 'true')

  constructor(protected readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
    if (!peerlyConfig && !hasLoggedPeerlyDisabled) {
      hasLoggedPeerlyDisabled = true
      this.logger.warn(PEERLY_NOT_CONFIGURED_MESSAGE)
    }
  }

  private requireConfig(): PeerlyConfig {
    if (!peerlyConfig) {
      throw new BadRequestException(PEERLY_NOT_CONFIGURED_MESSAGE)
    }
    return peerlyConfig
  }

  get baseUrl(): string {
    return this.requireConfig().baseUrl
  }

  get email(): string {
    return this.requireConfig().email
  }

  get password(): string {
    return this.requireConfig().password
  }

  get accountNumber(): string {
    return this.requireConfig().accountNumber
  }
}
