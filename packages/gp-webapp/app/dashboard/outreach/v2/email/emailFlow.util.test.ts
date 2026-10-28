import { describe, expect, it } from 'vitest'
import {
  checkSchedule,
  composeIssues,
  initialCompose,
  nextWarmingCap,
  toDraftSave,
  uploadSummary,
  warmingCap,
} from './emailFlow.util'

describe('upload summary and warming', () => {
  it('folds invalid and unsubscribed rows into skipped', () => {
    expect(
      uploadSummary({
        ready: 4812,
        invalid: 30,
        unsubscribed: 7,
        duplicate: 12,
      }),
    ).toBe('4,812 ready, 37 skipped, 12 duplicates')
  })

  it('reads the cap off the warming step and clamps past the last one', () => {
    expect(warmingCap(0)).toBe(1000)
    expect(warmingCap(1)).toBe(5000)
    expect(warmingCap(99)).toBe(250000)
    expect(nextWarmingCap(0)).toBe(5000)
    expect(nextWarmingCap(4)).toBeNull()
  })
})

describe('composeIssues', () => {
  const filled = { ...initialCompose, subject: 'Hi', body: 'Hello' }

  it('needs a subject and a body', () => {
    expect(composeIssues(initialCompose)).toEqual({
      subject: 'Add a subject line.',
      body: 'Write your message.',
    })
    expect(composeIssues(filled)).toEqual({})
  })

  it('requires a button on call to action', () => {
    expect(
      composeIssues({ ...filled, layout: 'call_to_action' }).button,
    ).toBeDefined()
    expect(
      composeIssues({
        ...filled,
        layout: 'call_to_action',
        buttonLabel: 'Donate',
        buttonUrl: 'https://example.com',
      }),
    ).toEqual({})
  })

  it('wants both halves of a button and an https link', () => {
    expect(composeIssues({ ...filled, buttonLabel: 'Go' }).button).toBeDefined()
    expect(
      composeIssues({
        ...filled,
        buttonLabel: 'Go',
        buttonUrl: 'http://example.com',
      }).button,
    ).toBeDefined()
  })
})

describe('toDraftSave', () => {
  it('includes the uploaded image url', () => {
    expect(
      toDraftSave(
        'Intro',
        {
          ...initialCompose,
          subject: 'S',
          body: 'B',
          imageUrl: 'https://assets.example.com/email-images/o/x.png',
        },
        null,
        undefined,
      ),
    ).toMatchObject({
      imageUrl: 'https://assets.example.com/email-images/o/x.png',
    })
  })

  it('omits empty optionals so the full-replace save clears them', () => {
    expect(
      toDraftSave(
        'Intro',
        { ...initialCompose, subject: 'S', body: 'B' },
        null,
        undefined,
      ),
    ).toEqual({
      goal: 'Intro',
      layout: 'newsletter',
      theme: 'classic_blue',
      subject: 'S',
      body: 'B',
    })
  })

  it('carries the draft id, the button and the date', () => {
    const save = toDraftSave(
      'Intro',
      {
        ...initialCompose,
        subject: 'S',
        body: 'B',
        buttonLabel: 'Go',
        buttonUrl: 'https://example.com',
      },
      7,
      '2026-11-01T10:00:00.000Z',
    )
    expect(save).toMatchObject({
      id: 7,
      buttonLabel: 'Go',
      buttonUrl: 'https://example.com',
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
