import type {
  IdeologyBucket,
  RecommendedListChannel,
  RecommendedListVariant,
} from '@goodparty_org/contracts'
import type { VoterFilterBase } from '../shared/schemas/voterFilterBase.schema'
import { ElectionCode } from '@/elections/types/elections.types'
import {
  IDEOLOGY_COLUMN_VALUE,
  RECOMMENDED_LISTS_REGISTRY,
  VOTER_STATUS_BANDS,
} from './recommendedLists.registry'

type VoterFilterShape = VoterFilterBase

// Which propensity band counts as "reliable enough to be worth contacting",
// given the electorate this race actually draws.
//
// `Voter_Status` is a fixed set of national cut points on
// `Voter_Turnout_Probability`, and that probability is modelled for ONE
// election: the November general of the current even year. There is only one
// voter-level turnout score in the people API. So the `reliable` band
// (Super + Likely, p >= 0.50) is calibrated to a November electorate, and it
// is calibrated well: across 3,378 upcoming November races its size has a
// median of 1.01x the race's projected turnout.
//
// An off-cycle election draws roughly half that electorate. The voter
// contact goal (3x the vote goal, so ~1.5x projected turnout) halves with
// it, while the band does not move at all, so the same filter comes out
// about twice the size it should be: a median 1.91x projected turnout across
// 836 off-cycle races, with 62.9% of them recommending a list larger than
// the whole contact goal. Narrowing to `high` (Super alone, p >= 0.75) puts
// that back to 1.26x, which restores roughly the same band-equals-electorate
// property the November case has.
//
// `high` specifically, and not some new threshold, because the CRM exposes
// `voterStatus` as an inclusion array over these four labels. The only
// cutoffs a recommendation can express are 0.25, 0.50 and 0.75, and a
// recommended list has to stay something the candidate could have built
// themselves. See docs/features/recommended-lists.md.
//
// DECISION FOR REVIEW -- the null case. Null here means "we could not
// resolve the race", not "the race has no electorate": the mart derives the
// tag from the race's own election date and inner-joins it, so every served
// race carries one, independent of whether a turnout projection joined. What
// reaches this function as null is a campaign with no `raceId`, a race
// election-api has no row for, an election-api outage, or an election-api
// deployed before the field existed -- the caller collapses all of those to
// null.
//
// This keeps `reliable`, i.e. today's behaviour, on the grounds that an
// unresolved race should not have its recommendations quietly narrowed. The
// other defensible choice is to treat unknown as off-cycle and prefer the
// smaller list. Flipping the condition below is the whole change, and one
// test asserts each direction.
//
// Note the shape of that condition: only a KNOWN non-General code narrows
// the band, and `== null` catches undefined as well as null, so a caller
// with a loosely typed race context that omits the field lands on the
// fallback rather than being silently narrowed by an absent value.
const reliableBandFor = (
  electionCode: ElectionCode | null,
): readonly string[] =>
  electionCode == null || electionCode === ElectionCode.General
    ? VOTER_STATUS_BANDS.reliable
    : VOTER_STATUS_BANDS.high

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
  electionCode: ElectionCode | null,
): Partial<VoterFilterShape> => {
  // Only the `reliable` band moves with the electorate. `high`, `mid` and
  // `belowHigh` are deliberately left alone -- see the note on
  // buildVariantFilter.
  const reliable = reliableBandFor(electionCode)
  switch (variant) {
    case 'introNeverIded':
      return {
        voterStatus: [...reliable],
        supportStatus: ['unknown'],
      }
    case 'persuadeAffinity':
      return {
        voterStatus: [...reliable],
        independentAffinity: true,
      }
    case 'persuadeIdeology':
      return {
        voterStatus: [...reliable],
        ...ideologyFilter(ideologyBucket),
      }
    case 'persuadeUndecided':
      return {
        voterStatus: [...reliable],
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
        voterStatus: [...reliable],
        independentAffinity: true,
      }
    case 'earlyVoteIdeology':
      return {
        voterStatus: [...reliable],
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

// `electionCode` is required rather than defaulted: the band a race gets is
// policy, and a caller that forgets to pass one would silently serve the
// November band to an off-cycle race, which is the exact bug this argument
// exists to fix. Pass null explicitly where the code is genuinely unknown.
//
// SCOPE NOTE. This narrows only the `reliable` band, which is the screen on
// `introNeverIded`, the three persuade variants, and the two modelled
// early-vote variants. The GOTV variants are untouched on purpose:
// `electionDayAffinity` / `electionDayIdeology` use `mid` (Likely +
// Unreliable) and `electionDaySupporters` uses `belowHigh`, and those bands
// are deliberately *below* the likely-voter screen because chasing
// near-certain voters on election day is wasted contact. Their off-cycle
// analogue is not simply "one notch tighter" and nothing in the sizing
// analysis measured them against the contact goal, so shifting them is a
// separate decision with its own evidence, not a consistency fix to fold in
// here. The two event variants already sit at `high`, and there is no
// tighter band to move them to.
export const buildVariantFilter = (
  variant: RecommendedListVariant,
  channel: RecommendedListChannel,
  ideologyBucket: IdeologyBucket | null,
  electionCode: ElectionCode | null,
): VoterFilterShape | null => {
  if (
    RECOMMENDED_LISTS_REGISTRY[variant].requiresIdeologyBucket &&
    !ideologyBucket
  ) {
    return null
  }

  return {
    ...buildUniverse(variant, ideologyBucket, electionCode),
    ...CHANNEL_CONTACTABILITY[channel],
  }
}
