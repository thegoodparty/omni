import {
  EmailLayoutKeySchema,
  EmailThemeKeySchema,
} from '@goodparty_org/contracts'
import { IS_PROD_DEPLOY, VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { OutreachEmail } from '../../generated/prisma'
import { DEV_ALLOWED_EMAIL_DOMAINS } from '../emailOutreach.const'
import { renderEmailTemplate } from '../templates/renderEmailTemplate'

type RenderableSend = Pick<
  OutreachEmail,
  | 'layout'
  | 'theme'
  | 'subject'
  | 'headline'
  | 'body'
  | 'imageUrl'
  | 'buttonLabel'
  | 'buttonUrl'
  | 'paidForBy'
>

export const renderOutreachEmail = (row: RenderableSend, senderName: string) =>
  renderEmailTemplate(
    EmailLayoutKeySchema.parse(row.layout),
    EmailThemeKeySchema.parse(row.theme),
    {
      subject: row.subject,
      headline: row.headline,
      body: row.body,
      imageUrl: row.imageUrl,
      button:
        row.buttonLabel && row.buttonUrl
          ? { label: row.buttonLabel, url: row.buttonUrl }
          : null,
      footer: { senderName, paidForBy: row.paidForBy },
    },
  )

// SES wants a non-ASCII display name encoded as an RFC 2047 word.
export const formatFrom = (displayName: string, address: string): string => {
  const clean = displayName.replace(/["\\\r\n]/g, '').trim()
  if (/^[\x20-\x7e]*$/.test(clean)) {
    return `"${clean}" <${address}>`
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?= <${address}>`
}

// Only a live non-prod deploy (dev) reaches real SES with real addresses;
// mock mode sends nowhere and prod sends to everyone.
export const isBlockedByDevAllowlist = (email: string): boolean => {
  if (IS_PROD_DEPLOY || VENDOR_MODE !== 'live') return false
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  return !DEV_ALLOWED_EMAIL_DOMAINS.includes(domain)
}
