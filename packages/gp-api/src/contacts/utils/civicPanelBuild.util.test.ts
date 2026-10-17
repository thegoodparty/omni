import { describe, expect, it } from 'vitest'
import { addDays, subDays } from 'date-fns'
import {
  areaAround,
  nextStep,
  pickWalkableArea,
  sizePanelWave,
  stepStatus,
  waveIsDue,
} from './civicPanelBuild.util'

const pools = { text: 50_000, phone: 50_000, door: 50_000 }

describe('sizePanelWave', () => {
  it('texts the whole gap at the cold rate when nobody can be called or visited', () => {
    expect(
      sizePanelWave({
        gap: 100,
        hoursPerWeek: 1,
        pools: { text: 50_000, phone: 0, door: 0 },
      }),
    ).toEqual([{ channel: 'text', position: 1, targetSize: 3_334 }])
  })

  it('splits an hour a week between calls and one walkable area', () => {
    expect(sizePanelWave({ gap: 100, hoursPerWeek: 1, pools })).toEqual([
      { channel: 'text', position: 1, targetSize: 3_150 },
      { channel: 'phone_banking', position: 1, targetSize: 30 },
      { channel: 'door_knocking', position: 1, targetSize: 40 },
    ])
  })

  it('caps doors at two areas and gives the spare hours to calls', () => {
    expect(sizePanelWave({ gap: 100, hoursPerWeek: 10, pools })).toEqual([
      { channel: 'text', position: 1, targetSize: 1_917 },
      { channel: 'phone_banking', position: 1, targetSize: 450 },
      { channel: 'door_knocking', position: 1, targetSize: 100 },
      { channel: 'door_knocking', position: 2, targetSize: 100 },
    ])
  })

  it('never sizes a channel past the gap it can fill', () => {
    expect(sizePanelWave({ gap: 2, hoursPerWeek: 10, pools })).toEqual([
      { channel: 'door_knocking', position: 1, targetSize: 20 },
    ])
  })

  it('skips a channel nobody can be reached on and caps texts at the pool', () => {
    expect(
      sizePanelWave({
        gap: 100,
        hoursPerWeek: 1,
        pools: { text: 500, phone: 0, door: 50_000 },
      }),
    ).toEqual([
      { channel: 'text', position: 1, targetSize: 500 },
      { channel: 'door_knocking', position: 1, targetSize: 40 },
    ])
  })

  it('makes nothing once the goal is met', () => {
    expect(sizePanelWave({ gap: 0, hoursPerWeek: 3, pools })).toEqual([])
  })
})

describe('pickWalkableArea', () => {
  const at = (key: string, lat: number, lng: number) => ({
    id: `${key}-person`,
    lat,
    lng,
    addressKey: key,
  })

  it('takes the households nearest the densest cluster', () => {
    const dense = Array.from({ length: 6 }, (_, i) =>
      at(`dense-${i}`, 40 + i * 0.0002, -75),
    )
    const sparse = [at('far-1', 41, -76), at('far-2', 41.5, -76.5)]

    const picked = pickWalkableArea([...sparse, ...dense], 4)

    expect(picked).toHaveLength(4)
    expect(picked.every((h) => h.lat < 40.01)).toBe(true)
  })

  it('groups the people of one household into one door', () => {
    const picked = pickWalkableArea(
      [
        { id: 'a', lat: 40, lng: -75, addressKey: 'home' },
        { id: 'b', lat: 40, lng: -75, addressKey: 'home' },
      ],
      5,
    )
    expect(picked).toEqual([{ lat: 40, lng: -75, personIds: ['a', 'b'] }])
  })

  it('draws a closed box around what it picked', () => {
    const area = areaAround([
      { lat: 40, lng: -75 },
      { lat: 40.001, lng: -75.001 },
    ])
    const ring = area?.coordinates[0] ?? []
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })
})

describe('step status and waves', () => {
  const now = new Date('2026-10-15T15:00:00Z')
  const base = {
    channel: 'text' as const,
    startedAt: null,
    completedAt: null,
    expectedRepliesBy: null,
    skippedAt: null,
  }

  it('reads a text from scheduled to waiting to done', () => {
    const started = { ...base, startedAt: subDays(now, 1) }
    expect(
      stepStatus(
        { ...started, expectedRepliesBy: addDays(now, 10) },
        false,
        now,
      ),
    ).toBe('in_progress')
    expect(
      stepStatus(
        { ...started, expectedRepliesBy: addDays(now, 1) },
        false,
        now,
      ),
    ).toBe('waiting_on_replies')
    expect(stepStatus({ ...started, completedAt: now }, false, now)).toBe(
      'done',
    )
  })

  it('reads an untouched step in an earlier wave as skipped', () => {
    expect(stepStatus(base, true, now)).toBe('skipped')
    expect(stepStatus(base, false, now)).toBe('not_started')
  })

  it('reads a skip only while nothing was started from the step', () => {
    expect(stepStatus({ ...base, skippedAt: now }, false, now)).toBe('skipped')
    expect(
      stepStatus(
        { ...base, skippedAt: now, startedAt: now, channel: 'phone_banking' },
        false,
        now,
      ),
    ).toBe('in_progress')
  })

  it('does not wait on a skipped step, and moves on when all were skipped', () => {
    const done = { ...base, status: 'done' as const, completedAt: now }
    const skipped = {
      ...base,
      channel: 'door_knocking' as const,
      skippedAt: now,
      status: 'skipped' as const,
    }
    const untouched = { ...base, status: 'not_started' as const }
    expect(waveIsDue([done, skipped], now)).toBe(true)
    expect(waveIsDue([skipped], now)).toBe(true)
    expect(waveIsDue([skipped, untouched], now)).toBe(false)
  })

  it('moves to the next wave once the started steps are done and the rest waited', () => {
    const done = { ...base, status: 'done' as const, completedAt: now }
    const untouched = {
      ...base,
      channel: 'door_knocking' as const,
      status: 'not_started' as const,
    }
    expect(waveIsDue([done], now)).toBe(true)
    expect(waveIsDue([done, untouched], now)).toBe(false)
    expect(waveIsDue([done, untouched], addDays(now, 14))).toBe(true)
    expect(waveIsDue([untouched], addDays(now, 60))).toBe(false)
  })

  it('points next at a ready step, texts first, then at the replies', () => {
    const steps = [
      {
        ...base,
        id: 'calls',
        position: 1,
        channel: 'phone_banking' as const,
        status: 'not_started' as const,
      },
      { ...base, id: 'text', position: 1, status: 'not_started' as const },
    ]
    expect(nextStep(steps)).toMatchObject({
      stepId: 'text',
      href: '/dashboard/contacts/citizens-panel?step=text',
    })
    expect(
      nextStep([
        {
          ...base,
          id: 'text',
          position: 1,
          startedAt: now,
          expectedRepliesBy: new Date('2026-10-20T12:00:00Z'),
          status: 'waiting_on_replies' as const,
        },
      ]),
    ).toEqual({
      stepId: 'text',
      channel: 'text',
      status: 'waiting_on_replies',
      line: 'Replies to your civic panel invite should be in by Tuesday, October 20',
      href: null,
    })
  })
})
