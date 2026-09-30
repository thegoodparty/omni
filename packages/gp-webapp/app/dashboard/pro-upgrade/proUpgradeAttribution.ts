import { z } from 'zod'
import { PRO_UPGRADE_ENTRY_PATH } from 'app/shared/experiments/proUpgrade3Flag'

// Where the press that entered the wizard happened. Only `Pro Upgrade - Flow
// Started` carries it: funnels group by that first step, so the step events
// after it don't need it.
export const ProUpgradeSourceSchema = z.enum([
  'navigation',
  'dashboard_banner',
  'auto_modal',
  'account_settings',
  'opponent_research',
  'contacts',
  'direct',
])
export type ProUpgradeSource = z.infer<typeof ProUpgradeSourceSchema>

// `generic` for the all-of-Pro pitch; an outreach channel when the pitch was
// that channel's. Same vocabulary as the outreach gate events.
export const ProUpgradeChannelSchema = z.enum([
  'generic',
  'sms',
  'robocall',
  'door',
  'phone-bank',
])
export type ProUpgradeChannel = z.infer<typeof ProUpgradeChannelSchema>

// A type alias, not an interface, so it passes straight to trackEvent's
// index-signature props.
export type ProUpgradeAttribution = {
  source: ProUpgradeSource
  channel: ProUpgradeChannel
  // The literal label on the button that was pressed.
  cta?: string
}

// The CTA is free text off the URL, so it is capped rather than allowlisted.
const CTA_MAX_LENGTH = 80

export const proUpgradeHref = ({
  source,
  channel,
  cta,
}: ProUpgradeAttribution): string => {
  const params = new URLSearchParams({ source, channel })
  if (cta) params.set('cta', cta)
  return `${PRO_UPGRADE_ENTRY_PATH}?${params.toString()}`
}

export const parseProUpgradeAttribution = (
  params: Pick<URLSearchParams, 'get'> | null,
): ProUpgradeAttribution => {
  const source = ProUpgradeSourceSchema.safeParse(params?.get('source'))
  const channel = ProUpgradeChannelSchema.safeParse(params?.get('channel'))
  const cta = params?.get('cta')?.trim().slice(0, CTA_MAX_LENGTH)
  return {
    source: source.success ? source.data : 'direct',
    channel: channel.success ? channel.data : 'generic',
    ...(cta ? { cta } : {}),
  }
}
