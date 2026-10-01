import { z } from 'zod'
import type { CampaignStrategyPhaseKey } from '@goodparty_org/contracts'
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
  // An outreach flow's own source (`OutreachFlowSource`), carried into the
  // wizard its Pro gate embeds.
  'outreach_page',
  'draft',
  'campaign_plan',
  'campaign_manager',
  'voter_data',
  'door_knocking_page',
  'deep_link',
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
  // The tracker task an outreach flow was launched from, under the names the
  // outreach events already use, so the two join.
  trackerTaskId?: string
  phase?: CampaignStrategyPhaseKey
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
