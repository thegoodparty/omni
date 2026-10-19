import type {
  ReadRepresentativeness,
  UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

export const WEIGHTING_STATUS: Record<ReadRepresentativeness, string> = {
  tooEarly: 'too_early',
  notYetRepresentative: 'not_yet_representative',
  gettingClose: 'getting_close',
  representative: 'representative',
  enoughAnswers: 'enough_answers',
}

const BUCKETS: Record<
  UnderrepresentedGroup,
  { dimension: 'age' | 'tenure' | 'gender' | 'area'; group: string }
> = {
  age18to64: { dimension: 'age', group: 'age_18_to_64' },
  age65plus: { dimension: 'age', group: 'age_65_plus' },
  owners: { dimension: 'tenure', group: 'owners' },
  renters: { dimension: 'tenure', group: 'renters' },
  men: { dimension: 'gender', group: 'men' },
  women: { dimension: 'gender', group: 'women' },
  unreachedAreas: { dimension: 'area', group: 'unreached_areas' },
}

export type UnderHeardSource =
  | 'strip'
  | 'rail'
  | 'results_page'
  | 'proposal_card'

// One event per group the read named, so a group counts each time an
// official went after it.
export const trackUnderHeardTargeted = (
  priorityId: string,
  groups: readonly UnderrepresentedGroup[],
  source: UnderHeardSource,
): void => {
  groups.forEach((group, index) => {
    const { dimension, group: bucket } = BUCKETS[group]
    trackEvent(EVENTS.Priorities.UnderHeardGroupTargeted, {
      priorityId,
      dimension,
      group: bucket,
      targetType: group === 'unreachedAreas' ? 'area' : 'group',
      rank: index + 1,
      source,
    })
  })
}
