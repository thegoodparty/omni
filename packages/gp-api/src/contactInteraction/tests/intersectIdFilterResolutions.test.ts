import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  intersectIdFilterResolutions,
  MAX_RESOLVED_ID_SET_SIZE,
  type IdFilterResolution,
} from '../services/activityConditionResolution.service'

// ENG-10839: intersectIdFilterResolutions AND-composes activity-condition/
// support-status resolution with the contacts-made resolution — both
// destined for people-api's single `id` operator (e.g. a Win user combining
// "responded to campaign X" with "contacts made: 2" in one request). Pure
// function, no DB — every branch is unit-testable directly.
describe('intersectIdFilterResolutions', () => {
  const inFilter = (ids: string[]): IdFilterResolution => ({
    kind: 'filter',
    idFilter: { in: ids },
  })
  const notInFilter = (ids: string[]): IdFilterResolution => ({
    kind: 'filter',
    idFilter: { notIn: ids },
  })

  it('none is the identity value on either side', () => {
    const filter = inFilter(['p1'])
    expect(intersectIdFilterResolutions({ kind: 'none' }, filter)).toEqual(
      filter,
    )
    expect(intersectIdFilterResolutions(filter, { kind: 'none' })).toEqual(
      filter,
    )
    expect(
      intersectIdFilterResolutions({ kind: 'none' }, { kind: 'none' }),
    ).toEqual({ kind: 'none' })
  })

  it('empty short-circuits regardless of which side is empty', () => {
    const filter = inFilter(['p1'])
    expect(intersectIdFilterResolutions({ kind: 'empty' }, filter)).toEqual({
      kind: 'empty',
    })
    expect(intersectIdFilterResolutions(filter, { kind: 'empty' })).toEqual({
      kind: 'empty',
    })
    expect(
      intersectIdFilterResolutions({ kind: 'empty' }, { kind: 'none' }),
    ).toEqual({ kind: 'empty' })
  })

  it('in + in intersects to the common subset', () => {
    const result = intersectIdFilterResolutions(
      inFilter(['p1', 'p2', 'p3']),
      inFilter(['p2', 'p3', 'p4']),
    )
    expect(result.kind).toBe('filter')
    if (result.kind === 'filter' && 'in' in result.idFilter) {
      expect(new Set(result.idFilter.in)).toEqual(new Set(['p2', 'p3']))
    } else {
      throw new Error('expected an in-filter result')
    }
  })

  it('in + in with no overlap collapses to empty', () => {
    const result = intersectIdFilterResolutions(
      inFilter(['p1']),
      inFilter(['p2']),
    )
    expect(result).toEqual({ kind: 'empty' })
  })

  it('in + notIn subtracts the excluded ids from the in set', () => {
    const result = intersectIdFilterResolutions(
      inFilter(['p1', 'p2', 'p3']),
      notInFilter(['p2']),
    )
    expect(result.kind).toBe('filter')
    if (result.kind === 'filter' && 'in' in result.idFilter) {
      expect(new Set(result.idFilter.in)).toEqual(new Set(['p1', 'p3']))
    } else {
      throw new Error('expected an in-filter result')
    }
  })

  it('notIn + in subtracts the same way regardless of argument order', () => {
    const result = intersectIdFilterResolutions(
      notInFilter(['p2']),
      inFilter(['p1', 'p2', 'p3']),
    )
    expect(result.kind).toBe('filter')
    if (result.kind === 'filter' && 'in' in result.idFilter) {
      expect(new Set(result.idFilter.in)).toEqual(new Set(['p1', 'p3']))
    } else {
      throw new Error('expected an in-filter result')
    }
  })

  it('in + notIn collapses to empty when the notIn set covers the whole in set', () => {
    const result = intersectIdFilterResolutions(
      inFilter(['p1', 'p2']),
      notInFilter(['p1', 'p2', 'p3']),
    )
    expect(result).toEqual({ kind: 'empty' })
  })

  it('notIn + notIn unions the exclusions', () => {
    const result = intersectIdFilterResolutions(
      notInFilter(['p1', 'p2']),
      notInFilter(['p2', 'p3']),
    )
    expect(result.kind).toBe('filter')
    if (result.kind === 'filter' && 'notIn' in result.idFilter) {
      expect(new Set(result.idFilter.notIn)).toEqual(
        new Set(['p1', 'p2', 'p3']),
      )
    } else {
      throw new Error('expected a notIn-filter result')
    }
  })

  // The cap check the task flagged for scrutiny: each side's notIn set is
  // independently capped at MAX_RESOLVED_ID_SET_SIZE by its own resolver
  // (activity-condition resolution and contacts-made resolution each
  // enforce this), but their UNION isn't — two ~70k sets with little
  // overlap can combine past the transport cap.
  it('throws when the unioned notIn exclusions exceed MAX_RESOLVED_ID_SET_SIZE', () => {
    const half = Math.ceil(MAX_RESOLVED_ID_SET_SIZE / 2) + 1
    const aIds = Array.from({ length: half }, (_, i) => `a-${i}`)
    const bIds = Array.from({ length: half }, (_, i) => `b-${i}`)

    expect(() =>
      intersectIdFilterResolutions(notInFilter(aIds), notInFilter(bIds)),
    ).toThrow(BadRequestException)
  })

  it('does not throw when the unioned notIn exclusions stay at or under the cap', () => {
    const ids = Array.from(
      { length: MAX_RESOLVED_ID_SET_SIZE },
      (_, i) => `p-${i}`,
    )
    const result = intersectIdFilterResolutions(
      notInFilter(ids),
      notInFilter(ids),
    )
    expect(result.kind).toBe('filter')
  })
})
