import { CHANNEL_FANOUT } from '@goodparty_org/contracts'
import type {
  CampaignStrategyPhaseKey,
  TaskChannel,
} from '@goodparty_org/contracts'

// The analytics channel vocabulary is the campaign tracker's `TaskChannel`,
// not `OutreachType`, so an outreach event and a tracker task can be joined on
// one value. The two vocabularies differ in four places and this map is the
// whole cross-walk: `p2p` is a text send, the two `native*` types collapse onto
// the channel they are a surface of, and `events` is singular in the contract.
//
// Pre-cutover rows carry the un-normalized `OutreachType` spellings; see
// `docs/features/voter-outreach-analytics.md` for the cutover date.
const OUTREACH_TYPE_TO_CHANNEL: Record<string, TaskChannel> = {
  text: 'text',
  p2p: 'text',
  robocall: 'robocall',
  doorKnocking: 'doorKnocking',
  nativeDoorKnocking: 'doorKnocking',
  phoneBanking: 'phoneBanking',
  nativePhoneBanking: 'phoneBanking',
  socialMedia: 'socialMedia',
  directMail: 'directMail',
  events: 'event',
  // The flow shell, the audience hook and the gate each named the channels
  // themselves before this vocabulary existed, so a text send had four
  // spellings across two properties and social had two. These fold those in:
  // every surface can keep its own prop type and still report one `medium`.
  sms: 'text',
  texting: 'text',
  social: 'socialMedia',
  door: 'doorKnocking',
  'phone-bank': 'phoneBanking',
  'Phone Banking': 'phoneBanking',
}

export const outreachChannel = (type: string): TaskChannel =>
  OUTREACH_TYPE_TO_CHANNEL[type] ?? 'general'

export type OutreachProduct = 'win' | 'serve'

// Which product an outreach event happened in. Door knocking, phone banking,
// social and SMS all run on both surfaces from the same components, so this is
// a PROPERTY rather than a second event name: one `Outreach - ...` event per
// thing, cut by product where a chart needs it. The two-name alternative
// doubled the taxonomy and made every cross-product total a union, which is
// the same shape that let the per-channel Complete events go dark one at a
// time. See docs/features/voter-outreach-analytics.md.
export const outreachProduct = (isServe: boolean): OutreachProduct =>
  isServe ? 'serve' : 'win'

// Where a tracker task launched the outreach. Both halves travel together or
// not at all — a phase without the task it came from names nothing joinable.
export interface OutreachTrackerOrigin {
  trackerTaskId: string
  phase: CampaignStrategyPhaseKey
}

export interface OutreachEventInput {
  channel: TaskChannel
  // Which product the event happened in. Required rather than defaulted: a
  // shared surface that forgot to pass it would silently report every Serve
  // campaign as Win, which is the failure this property exists to prevent.
  isServe: boolean
  // People this outreach reached. Omitted entirely on a channel with no
  // recipient count (social) — never sent as 0, which would read as a send
  // that reached nobody.
  recipientCount?: number
  // The scheduled or actual send date, NOT the event timestamp: a paid send is
  // scheduled days ahead of the click that bought it.
  sendDate?: string | Date | null
  // Dollars actually paid. Omitted on a free channel rather than sent as 0, so
  // an average spend per campaign is not diluted by the free ones.
  price?: number
  outreachCampaignId?: number
  // The name the candidate gave this campaign. Carried through from the
  // pre-consolidation schema, where the one call site sent the literal string
  // `'null'`. Omitted when there is no name rather than sent empty — a manual
  // log records work done offline and names nothing.
  campaignName?: string | null
  // The parent list a one-to-one channel's contacts roll up to: the turf for
  // door knocking, the call list for phone banking. The envelope id is not
  // reachable client-side on either surface.
  listId?: number
  audienceSource?: string
  tracker?: OutreachTrackerOrigin
}

const toSendDate = (value: string | Date): string =>
  (value instanceof Date ? value.toISOString() : value).slice(0, 10)

/**
 * The shared payload for `Outreach - Campaign Completed` and
 * `Outreach - Campaign Created`, and the channel/fanout pair the two
 * one-to-one contact events carry.
 *
 * Every optional property is OMITTED rather than nulled, because an absent
 * property and a zero mean different things on every one of them. Schema and
 * rationale: `docs/features/voter-outreach-analytics.md`.
 */
export const outreachEventProps = (
  input: OutreachEventInput,
): Record<string, string | number> => ({
  medium: input.channel,
  fanout: CHANNEL_FANOUT[input.channel],
  product: outreachProduct(input.isServe),
  // `voterContacts` is `recipientCount` under the name the retired per-channel
  // Complete events used. Kept so a chart built on the old property survives
  // the cutover, and mirrored exactly — including the omission on social —
  // rather than resurrected with the hardcoded 0 it used to carry.
  ...(input.recipientCount !== undefined
    ? {
        recipientCount: input.recipientCount,
        voterContacts: input.recipientCount,
      }
    : {}),
  ...(input.sendDate ? { sendDate: toSendDate(input.sendDate) } : {}),
  ...(input.price !== undefined ? { price: input.price } : {}),
  ...(input.outreachCampaignId !== undefined
    ? { outreachCampaignId: input.outreachCampaignId }
    : {}),
  ...(input.listId !== undefined ? { listId: input.listId } : {}),
  ...(input.campaignName ? { campaignName: input.campaignName } : {}),
  ...(input.audienceSource ? { audienceSource: input.audienceSource } : {}),
  ...(input.tracker
    ? { trackerTaskId: input.tracker.trackerTaskId, phase: input.tracker.phase }
    : {}),
})
