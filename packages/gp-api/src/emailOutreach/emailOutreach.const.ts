import { IS_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'

export const EMAIL_OUTREACH_DOMAIN = IS_PROD_DEPLOY
  ? 'outreachmail.goodparty.org'
  : 'outreachmail-dev.goodparty.org'

export const EMAIL_NAME_MAX_LENGTH = 100
export const EMAIL_ADDRESS_MAX_LENGTH = 254
export const FORWARD_CONFIRM_TTL_HOURS = 24
export const EMAIL_UPLOAD_MAX_BYTES = 2_000_000
