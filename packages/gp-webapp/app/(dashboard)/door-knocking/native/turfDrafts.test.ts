import { describe, expect, it } from 'vitest'
import { draftAsTurfLike, draftTurfId, nextTurfName } from './turfDrafts'
import type { TurfDraft } from './turfDrafts'

const draft = (over: Partial<TurfDraft> = {}): TurfDraft => ({
  clientId: 'draft-abc',
  polygon: [
    [-87.66, 41.92],
    [-87.65, 41.92],
    [-87.65, 41.93],
  ],
  color: '#16a34a',
  name: 'Turf 3',
  assigneeId: null,
  ...over,
})

describe('nextTurfName', () => {
  it('numbers across the whole campaign, not just this session', () => {
    // A candidate arriving through "Add another turf" is joining a campaign
    // that already holds turfs. Counting only the ones cut in this sitting
    // would hand them a second "Turf 1".
    expect(nextTurfName(0)).toBe('Turf 1')
    expect(nextTurfName(2)).toBe('Turf 3')
  })
})

describe('draftTurfId', () => {
  it('is stable for a client id, so the canvas keeps its identity', () => {
    expect(draftTurfId('draft-abc')).toBe(draftTurfId('draft-abc'))
  })

  it('is negative, where a server-issued turf id never is', () => {
    // The canvas's select/hover machinery is keyed on id, and a draft shares
    // that layer with real turfs — so the two id spaces must not overlap.
    for (const id of ['a', 'draft-1', '', 'draft-00000000-0000-0000']) {
      expect(draftTurfId(id)).toBeLessThan(0)
    }
  })

  it('tells two drafts apart', () => {
    expect(draftTurfId('draft-1')).not.toBe(draftTurfId('draft-2'))
  })
})

describe('draftAsTurfLike', () => {
  it('carries the three fields the polygon layer actually reads', () => {
    const turf = draftAsTurfLike(draft())

    expect(turf.color).toBe('#16a34a')
    expect(turf.name).toBe('Turf 3')
    expect(turf.geoPoly).toEqual({
      type: 'Polygon',
      coordinates: [draft().polygon],
    })
    expect(turf.id).toBe(draftTurfId('draft-abc'))
  })

  it('reports no counts and no envelope, because a draft has neither', () => {
    const turf = draftAsTurfLike(draft())

    // Zeros rather than real figures: nothing has been bought, so there is
    // no route to count over. Nothing that reports counts reads through this
    // adapter — the draft cards read `TurfDraft` and the pack directly.
    expect(turf.doorCount).toBe(0)
    expect(turf.peopleCount).toBe(0)
    expect(turf.loggedCount).toBe(0)
    expect(turf.knockedDoorCount).toBe(0)
    // Negative for the same reason the id is: a real envelope id is always
    // positive, so nothing can mistake this for one.
    expect(turf.outreachId).toBeLessThan(0)
  })

  it('is neither completed nor archived', () => {
    // The lifecycle lives on the envelope, and a draft has none — so a draft
    // must not read as a shelved or finished list on any surface that asks.
    const turf = draftAsTurfLike(draft())

    expect(turf.completed).toBe(false)
    expect(turf.archivedAt).toBeNull()
  })
})
