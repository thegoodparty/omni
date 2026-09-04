import type {
  IdeologyBucket,
  RecommendedListChannel,
  RecommendedListVariant,
} from '@goodparty_org/contracts'
import type { VoterFilterBase } from '../shared/schemas/voterFilterBase.schema'
import {
  IDEOLOGY_COLUMN_VALUE,
  RECOMMENDED_LISTS_REGISTRY,
  VOTER_STATUS_BANDS,
} from './recommendedLists.registry'

type VoterFilterShape = VoterFilterBase

// The inclusion-list expression of "not a known opponent supporter" — used
// on both event variants that carry the support exclusion.
const EVENT_SUPPORT_EXCLUSION = [
  'supporter',
  'undecided',
  'unknown',
  'refused',
] as const

// `voterFileFilter.utils.ts:430` collapses these same four booleans into the
// mart column values; this is the inverse, chosen once via
// IDEOLOGY_COLUMN_VALUE so the Liberal/progressive translation happens at
// one boundary.
const IDEOLOGY_FILTER_FIELD_BY_COLUMN_VALUE = {
  Liberal: 'ideologyLiberal',
  Moderate: 'ideologyModerate',
  Conservative: 'ideologyConservative',
} as const

const ideologyFilter = (
  bucket: IdeologyBucket | null,
): Partial<VoterFilterShape> => {
  if (!bucket) return {}
  const field =
    IDEOLOGY_FILTER_FIELD_BY_COLUMN_VALUE[IDEOLOGY_COLUMN_VALUE[bucket]]
  return { [field]: true }
}

const CHANNEL_CONTACTABILITY: Record<
  RecommendedListChannel,
  Partial<VoterFilterShape>
> = {
  sms: { hasCellPhone: true },
  robocall: { hasAnyPhone: true },
  phoneBanking: { hasAnyPhone: true },
  // Every voter has an address on file, so a contactability filter here
  // would narrow nothing. Door knocking's precinct restriction is applied
  // elsewhere — this function can't compute a per-precinct count.
  doorKnocking: {},
}

const buildUniverse = (
  variant: RecommendedListVariant,
  ideologyBucket: IdeologyBucket | null,
): Partial<VoterFilterShape> => {
  switch (variant) {
    case 'introNeverIded':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.reliable],
        supportStatus: ['unknown'],
      }
    case 'persuadeAffinity':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.reliable],
        independentAffinity: true,
      }
    case 'persuadeIdeology':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.reliable],
        ...ideologyFilter(ideologyBucket),
      }
    case 'persuadeUndecided':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.reliable],
        supportStatus: ['undecided'],
      }
    case 'eventSupporters':
      return { supportStatus: ['supporter'] }
    case 'eventAffinity':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.high],
        independentAffinity: true,
        supportStatus: [...EVENT_SUPPORT_EXCLUSION],
      }
    case 'eventIdeology':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.high],
        supportStatus: [...EVENT_SUPPORT_EXCLUSION],
        ...ideologyFilter(ideologyBucket),
      }
    case 'earlyVoteSupporters':
      return { supportStatus: ['supporter'] }
    case 'earlyVoteAffinity':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.reliable],
        independentAffinity: true,
      }
    case 'earlyVoteIdeology':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.reliable],
        ...ideologyFilter(ideologyBucket),
      }
    case 'electionDaySupporters':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.belowHigh],
        supportStatus: ['supporter'],
      }
    case 'electionDayAffinity':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.mid],
        independentAffinity: true,
      }
    case 'electionDayIdeology':
      return {
        voterStatus: [...VOTER_STATUS_BANDS.mid],
        ...ideologyFilter(ideologyBucket),
      }
  }
}

export const buildVariantFilter = (
  variant: RecommendedListVariant,
  channel: RecommendedListChannel,
  ideologyBucket: IdeologyBucket | null,
): VoterFilterShape | null => {
  if (
    RECOMMENDED_LISTS_REGISTRY[variant].requiresIdeologyBucket &&
    !ideologyBucket
  ) {
    return null
  }

  return {
    ...buildUniverse(variant, ideologyBucket),
    ...CHANNEL_CONTACTABILITY[channel],
  }
}
