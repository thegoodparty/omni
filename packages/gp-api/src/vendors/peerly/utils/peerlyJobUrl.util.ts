import { BadRequestException } from '@nestjs/common'
import { resolveEnvVar } from '../../../shared/env/env'

const PEERLY_NOT_CONFIGURED_MESSAGE =
  'Peerly texting is disabled: set PEERLY_API_BASE_URL and ' +
  'PEERLY_ACCOUNT_NUMBER'

export function getPeerlyJobUrl(jobId: string): string {
  const baseUrl = resolveEnvVar('PEERLY_API_BASE_URL')
  const accountNumber = resolveEnvVar('PEERLY_ACCOUNT_NUMBER')
  if (!baseUrl.configured || !accountNumber.configured) {
    throw new BadRequestException(PEERLY_NOT_CONFIGURED_MESSAGE)
  }
  const peerlyWebUrl = baseUrl.value.replace('/api', '')
  return `${peerlyWebUrl}/${accountNumber.value}/p2p/${jobId}`
}
