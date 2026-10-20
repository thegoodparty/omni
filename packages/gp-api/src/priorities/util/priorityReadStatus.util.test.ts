import { describe, expect, it } from 'vitest'
import { underrepresentedGroups } from './priorityReadStatus.util'
import type { RakingGap } from './raking.util'

const gap = (
  dimension: string,
  value: string,
  unweightedShare: number,
  censusShare: number,
  share = censusShare,
): RakingGap => ({ dimension, value, share, unweightedShare, censusShare })

describe('underrepresentedGroups', () => {
  it('names the two groups trailing the census most, before weighting', () => {
    expect(
      underrepresentedGroups(
        [
          gap('age', '65plus', 0.1, 0.18),
          gap('tract', '53017950100', 0.02, 0.3),
          gap('tract', 'other', 0.05, 0.1),
        ],
        true,
      ),
    ).toEqual(['unreachedAreas', 'age65plus'])
  })

  it('names an age band by its census range', () => {
    expect(
      underrepresentedGroups(
        [gap('age', '18to24', 0.04, 0.12), gap('age', 'other', 0.1, 0.3)],
        false,
      ),
    ).toEqual(['age18to24'])
  })

  it('skips groups trailing by less than 5 points', () => {
    expect(
      underrepresentedGroups([gap('age', '65plus', 0.17, 0.2)], true),
    ).toEqual([])
  })

  it('names a race group, but never other', () => {
    expect(
      underrepresentedGroups(
        [
          gap('race', 'black', 0.05, 0.2),
          gap('race', 'other', 0.0, 0.3),
          gap('race', 'hispanic', 0.1, 0.18),
        ],
        true,
      ),
    ).toEqual(['black', 'hispanic'])
  })

  it('leaves race unnamed when too few people have one on file', () => {
    expect(
      underrepresentedGroups(
        [gap('race', 'black', 0.05, 0.2), gap('age', '65plus', 0.1, 0.18)],
        false,
      ),
    ).toEqual(['age65plus'])
  })
})
