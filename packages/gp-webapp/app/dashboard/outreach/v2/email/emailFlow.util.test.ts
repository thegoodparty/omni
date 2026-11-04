import { describe, expect, it } from 'vitest'
import {
  checkSchedule,
  checkScheduleSlot,
  emailTimeOptions,
  nextWarmingCap,
  toDraftSave,
  warmingCap,
} from './emailFlow.util'
import { initialCompose } from './emailForm.util'

describe('warming', () => {
  it('reads the cap off the warming step and clamps past the last one', () => {
    expect(warmingCap(0)).toBe(1000)
    expect(warmingCap(1)).toBe(5000)
    expect(warmingCap(99)).toBe(250000)
    expect(nextWarmingCap(0)).toBe(5000)
    expect(nextWarmingCap(4)).toBeNull()
  })
})

describe('toDraftSave', () => {
  const state = {
    ...initialCompose(),
    subject: 'S',
    message: 'B',
  }

  it('sends the form as block content', () => {
    expect(toDraftSave('Intro', state, null, undefined, null)).toEqual({
      goal: 'Intro',
      content: {
        layout: 'personal_letter',
        theme: 'cream_and_forest',
        subject: 'S',
        blocks: [{ type: 'paragraph', text: 'B' }],
      },
    })
  })

  it('carries the draft id, the list and the date', () => {
    expect(
      toDraftSave('Intro', state, 7, '2026-11-01T10:00:00.000Z', 42),
    ).toMatchObject({
      id: 7,
      voterFileFilterId: 42,
      date: '2026-11-01T10:00:00.000Z',
    })
  })
})

describe('checkSchedule', () => {
  const now = new Date('2026-10-28T12:00:00')

  it('sends on payment when the time is now or past', () => {
    expect(checkSchedule('2026-10-28', '12:00', now)).toEqual({
      ok: true,
      iso: undefined,
    })
    expect(checkSchedule('2026-10-28', '09:00', now)).toEqual({
      ok: true,
      iso: undefined,
    })
  })

  it('schedules a future time', () => {
    expect(checkSchedule('2026-10-28', '12:01', now)).toEqual({
      ok: true,
      iso: new Date('2026-10-28T12:01').toISOString(),
    })
  })

  it('needs a day and time', () => {
    expect(checkSchedule('', '10:00', now).ok).toBe(false)
    expect(checkSchedule('2026-10-28', '', now).ok).toBe(false)
  })

  it('allows up to 30 days out and no further', () => {
    expect(checkSchedule('2026-11-27', '09:00', now).ok).toBe(true)
    expect(checkSchedule('2026-11-28', '09:00', now).ok).toBe(false)
  })
})

describe('emailTimeOptions', () => {
  const now = new Date('2026-10-28T12:00:00')

  it('offers sending once paid, then the hours still ahead, today', () => {
    const labels = emailTimeOptions(now, now).map((o) => o.label)
    expect(labels[0]).toBe("As soon as it's paid")
    expect(labels[1]).toBe('1:00 PM')
    expect(labels).not.toContain('12:00 PM')
    expect(labels.at(-2)).toBe('11:00 PM')
    expect(labels.at(-1)).toBe('Custom time…')
  })

  it('offers every hour and no send-now on a later day', () => {
    const labels = emailTimeOptions(new Date('2026-10-29T00:00:00'), now).map(
      (o) => o.label,
    )
    expect(labels).not.toContain("As soon as it's paid")
    expect(labels[0]).toBe('12:00 AM')
    expect(labels[12]).toBe('12:00 PM')
    expect(labels).toHaveLength(25)
    expect(labels.at(-1)).toBe('Custom time…')
  })
})

describe('checkScheduleSlot', () => {
  const now = new Date('2026-10-28T12:00:00')
  const tomorrow = new Date('2026-10-29T00:00:00')

  it('sends on payment for the send-now slot', () => {
    expect(checkScheduleSlot(now, 'now', '', now)).toEqual({
      ok: true,
      iso: undefined,
    })
  })

  it('needs a time picked', () => {
    expect(checkScheduleSlot(tomorrow, '', '', now)).toEqual({
      ok: false,
      message: 'Pick a time.',
    })
  })

  it('schedules an hourly slot or a custom time', () => {
    expect(checkScheduleSlot(tomorrow, '09:00', '', now)).toEqual({
      ok: true,
      iso: new Date('2026-10-29T09:00').toISOString(),
    })
    expect(checkScheduleSlot(tomorrow, 'custom', '09:30', now)).toEqual({
      ok: true,
      iso: new Date('2026-10-29T09:30').toISOString(),
    })
    expect(checkScheduleSlot(tomorrow, 'custom', '', now).ok).toBe(false)
  })
})

describe('email surfaces', () => {
  it('keeps Win and Serve nouns apart', async () => {
    const { WIN_EMAIL_SURFACE, SERVE_EMAIL_SURFACE } =
      await import('./emailSurface')
    const text = (s: object) => JSON.stringify(s)
    expect(text(SERVE_EMAIL_SURFACE)).not.toMatch(/voter|campaign/i)
    expect(text(WIN_EMAIL_SURFACE)).not.toMatch(/constituent|office/i)
    expect(SERVE_EMAIL_SURFACE.isServe).toBe(true)
    expect(SERVE_EMAIL_SURFACE.goals.map((g) => g.id)).toContain('custom')
  })
})
