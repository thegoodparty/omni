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
}

export const outreachChannel = (type: string): TaskChannel =>
  OUTREACH_TYPE_TO_CHANNEL[type] ?? 'general'

// Where a tracker task launched the outreach. Both halves travel together or
// not at all — a phase without the task it came from names nothing joinable.
export interface OutreachTrackerOrigin {
  trackerTaskId: string
  phase: CampaignStrategyPhaseKey
}

export interface OutreachEventInput {
  channel: TaskChannel
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
 * The shared payload for `Voter Outreach - Campaign Completed` and
 * `Voter Outreach - Campaign Created`, and the channel/fanout pair the two
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
  ...(input.recipientCount !== undefined
    ? { recipientCount: input.recipientCount }
    : {}),
  ...(input.sendDate ? { sendDate: toSendDate(input.sendDate) } : {}),
  ...(input.price !== undefined ? { price: input.price } : {}),
  ...(input.outreachCampaignId !== undefined
    ? { outreachCampaignId: input.outreachCampaignId }
    : {}),
  ...(input.listId !== undefined ? { listId: input.listId } : {}),
  ...(input.audienceSource ? { audienceSource: input.audienceSource } : {}),
  ...(input.tracker
    ? { trackerTaskId: input.tracker.trackerTaskId, phase: input.tracker.phase }
    : {}),
})
