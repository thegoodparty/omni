import { describe, expect, it } from 'vitest'
import { OutreachStatus, OutreachType } from '../../generated/prisma'
import { collapseDoorKnockingCampaigns } from './collapseDoorKnockingCampaigns.util'

const at = (iso: string) => new Date(iso)

const row = (
  id: number,
  outreachType: OutreachType,
  campaignOutreachId: number | null,
  createdAt: string,
  status: OutreachStatus | null = OutreachStatus.in_progress,
) => ({
  id,
  outreachType,
  campaignOutreachId,
  createdAt: at(createdAt),
  status,
})

const dk = (
  id: number,
  campaignOutreachId: number | null,
  createdAt: string,
  status: OutreachStatus | null = OutreachStatus.in_progress,
) =>
  row(
    id,
    OutreachType.nativeDoorKnocking,
    campaignOutreachId,
    createdAt,
    status,
  )

const done = OutreachStatus.completed
const going = OutreachStatus.in_progress

describe('collapseDoorKnockingCampaigns', () => {
  it('collapses an anchor and its siblings into one row carrying the count', () => {
    // The shape the multi-turf create writes: one anchor with
    // `campaignOutreachId: null` and every other turf pointing at it.
    const result = collapseDoorKnockingCampaigns([
      dk(1, null, '2026-01-01T00:00:00Z'),
      dk(2, 1, '2026-01-02T00:00:00Z'),
      dk(3, 1, '2026-01-03T00:00:00Z'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(1)
    expect(result[0]?.turfCount).toBe(3)
  })

  it('reports a solo door-knocking campaign as a campaign of one', () => {
    const result = collapseDoorKnockingCampaigns([
      dk(7, null, '2026-01-01T00:00:00Z'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(7)
    expect(result[0]?.turfCount).toBe(1)
  })

  it('prefers the row that owns the anchor id over an earlier sibling', () => {
    // Anchor last and newest, so neither input order nor `createdAt` can
    // produce the right answer by accident — only the id match can.
    const result = collapseDoorKnockingCampaigns([
      dk(2, 5, '2026-01-01T00:00:00Z'),
      dk(3, 5, '2026-01-02T00:00:00Z'),
      dk(5, null, '2026-01-09T00:00:00Z'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(5)
    expect(result[0]?.turfCount).toBe(3)
  })

  it('falls back to the earliest sibling when no row owns the anchor id', () => {
    // The defensive branch: the anchor was hard-deleted while siblings still
    // carry its id. The campaign has to surface rather than vanish, and the
    // row that stands in for it is the earliest-created one.
    const result = collapseDoorKnockingCampaigns([
      dk(8, 99, '2026-03-04T00:00:00Z'),
      dk(6, 99, '2026-03-02T00:00:00Z'),
      dk(9, 99, '2026-03-09T00:00:00Z'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(6)
    expect(result[0]?.turfCount).toBe(3)
  })

  it('passes every non-door-knocking row through as its own campaign', () => {
    const result = collapseDoorKnockingCampaigns([
      row(10, OutreachType.text, null, '2026-02-01T00:00:00Z'),
      row(11, OutreachType.socialMedia, null, '2026-02-02T00:00:00Z'),
    ])

    expect(result.map((r) => [r.id, r.turfCount])).toEqual([
      [10, 1],
      [11, 1],
    ])
  })

  it('keeps door-knocking and other channels both present in one list', () => {
    const result = collapseDoorKnockingCampaigns([
      row(20, OutreachType.text, null, '2026-04-01T00:00:00Z'),
      dk(21, null, '2026-04-02T00:00:00Z'),
      dk(22, 21, '2026-04-03T00:00:00Z'),
    ])

    // Two campaigns out of three rows: the text row untouched, the two turfs
    // as one. Order is not asserted — the history surfaces sort newest-first
    // themselves off `date ?? createdAt`.
    expect(
      [...result].sort((a, b) => a.id - b.id).map((r) => [r.id, r.turfCount]),
    ).toEqual([
      [20, 1],
      [21, 2],
    ])
  })

  it('treats both door-knocking types as the same channel', () => {
    // The legacy `doorKnocking` type and the native one collapse together:
    // an org mid-migration must not see its campaign split in two.
    const result = collapseDoorKnockingCampaigns([
      row(30, OutreachType.doorKnocking, null, '2026-05-01T00:00:00Z'),
      row(31, OutreachType.nativeDoorKnocking, 30, '2026-05-02T00:00:00Z'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(30)
    expect(result[0]?.turfCount).toBe(2)
  })

  // The campaign's status is not the anchor turf's. `complete` takes a TURF
  // id and writes one envelope, so an anchor finished ahead of its siblings
  // used to make the whole campaign read "Done" in outreach history while
  // turfs were still unwalked.
  it('is not done while any turf in the campaign is unfinished', () => {
    const result = collapseDoorKnockingCampaigns([
      dk(1, null, '2026-01-01T00:00:00Z', done),
      dk(2, 1, '2026-01-02T00:00:00Z', going),
      dk(3, 1, '2026-01-03T00:00:00Z', done),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(1)
    expect(result[0]?.status).toBe(going)
  })

  it('is done once every turf is', () => {
    const result = collapseDoorKnockingCampaigns([
      dk(1, null, '2026-01-01T00:00:00Z', done),
      dk(2, 1, '2026-01-02T00:00:00Z', done),
    ])

    expect(result[0]?.status).toBe(done)
  })

  it('leaves an unfinished anchor alone', () => {
    // The correction only ever walks a campaign BACK from done. An anchor
    // that is still going stays going, whatever its siblings say.
    const result = collapseDoorKnockingCampaigns([
      dk(1, null, '2026-01-01T00:00:00Z', going),
      dk(2, 1, '2026-01-02T00:00:00Z', done),
    ])

    expect(result[0]?.status).toBe(going)
  })

  it('does not touch a non-door-knocking row’s status', () => {
    const result = collapseDoorKnockingCampaigns([
      row(10, OutreachType.text, null, '2026-02-01T00:00:00Z', done),
    ])

    expect(result[0]?.status).toBe(done)
  })

  it('returns nothing for no rows', () => {
    expect(collapseDoorKnockingCampaigns([])).toEqual([])
  })
})
