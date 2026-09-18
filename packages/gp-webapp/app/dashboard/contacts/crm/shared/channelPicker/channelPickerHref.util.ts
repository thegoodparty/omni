import type { RecommendedList } from '@goodparty_org/contracts'
import type { SegmentResponse } from '../contacts-types'

// What the candidate pressed Send outreach on. A saved list and the whole
// district travel as they always have; a recommendation travels as the list
// it already matches, or as its variant when nothing is saved yet.
export type ChannelPickerTarget =
  | { kind: 'list'; segment: SegmentResponse }
  | { kind: 'universe' }
  | { kind: 'recommended'; recommendation: RecommendedList }

// The five channels the hub's tiles offer. Social has no audience step, so
// it is listed for completeness and carries nothing but the source.
export type ChannelPickerChannel =
  | 'text'
  | 'robocall'
  | 'phoneBanking'
  | 'doorKnocking'
  | 'socialMedia'

// The hub's `?compose=` vocabulary (OutreachComposeDeepLink) — the hub owns
// the one mount of each flow, so opening a channel from here means linking
// into it with the flow named, exactly as a campaign-plan task CTA does.
const COMPOSE_PARAM: Record<
  Exclude<ChannelPickerChannel, 'doorKnocking'>,
  string
> = {
  text: 'text',
  robocall: 'robocall',
  phoneBanking: 'phoneBanking',
  socialMedia: 'social',
}

const audienceParam = (target: ChannelPickerTarget): string | null => {
  if (target.kind === 'list') return `listId=${target.segment.id}`
  if (target.kind === 'universe') return null
  return target.recommendation.existingFilterId !== null
    ? `listId=${target.recommendation.existingFilterId}`
    : `recommended=${target.recommendation.variant}`
}

export const channelPickerHref = (
  channel: ChannelPickerChannel,
  target: ChannelPickerTarget,
): string => {
  const audience = audienceParam(target)
  if (channel === 'doorKnocking') {
    return audience
      ? `/dashboard/door-knocking?create=1&${audience}`
      : '/dashboard/door-knocking?create=1'
  }
  const base = `/dashboard/outreach?compose=${COMPOSE_PARAM[channel]}&source=voter_data`
  return channel === 'socialMedia' || !audience ? base : `${base}&${audience}`
}
