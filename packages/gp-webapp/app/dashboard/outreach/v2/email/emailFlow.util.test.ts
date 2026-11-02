import { describe, expect, it } from 'vitest'
import {
  checkSchedule,
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
    expect(
      toDraftSave('Intro', state, null, undefined, {
        listId: null,
        consent: false,
      }),
    ).toEqual({
      goal: 'Intro',
      content: {
        layout: 'personal_letter',
        theme: 'cream_and_forest',
        subject: 'S',
        blocks: [{ type: 'paragraph', text: 'B' }],
      },
      consentConfirmed: false,
    })
  })

  it('carries the draft id, the list and the date', () => {
    expect(
      toDraftSave('Intro', state, 7, '2026-11-01T10:00:00.000Z', {
        listId: 42,
        consent: true,
      }),
    ).toMatchObject({
      id: 7,
      voterFileFilterId: 42,
      consentConfirmed: true,
      date: '2026-11-01T10:00:00.000Z',
    })
  })
})

describe('checkSchedule', () => {
  const now = new Date('2026-10-28T12:00:00')

  it('sends now without a date', () => {
    expect(checkSchedule(true, '', '', now)).toEqual({
      ok: true,
      iso: undefined,
    })
  })

  it('needs a day and time, not in the past', () => {
    expect(checkSchedule(false, '', '10:00', now).ok).toBe(false)
    expect(checkSchedule(false, '2026-10-28', '09:00', now).ok).toBe(false)
  })

  it('allows up to 30 days out and no further', () => {
    expect(checkSchedule(false, '2026-11-27', '09:00', now).ok).toBe(true)
    expect(checkSchedule(false, '2026-11-28', '09:00', now).ok).toBe(false)
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
