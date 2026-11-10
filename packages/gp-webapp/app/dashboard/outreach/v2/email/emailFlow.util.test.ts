import { describe, expect, it } from 'vitest'
import {
  checkSchedule,
  checkScheduleSlot,
  emailTimeOptions,
  loadEmailDraft,
  nextWarmingCap,
  toDraftSave,
} from './emailFlow.util'
import type { EmailDraft } from '@goodparty_org/contracts'
import { initialCompose, toContent } from './emailForm.util'
import { WIN_EMAIL_SURFACE } from './emailSurface'

describe('warming', () => {
  it('reads the next cap off the warming step', () => {
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
        theme: 'neutral',
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

describe('loadEmailDraft', () => {
  const now = new Date('2026-10-28T12:00:00')
  const compose = {
    ...initialCompose(),
    theme: 'classic_blue' as const,
    subject: 'Meet me Saturday',
    title: 'Town hall',
    message: 'Hi {{first_name}},\n\n## Where\n\nThe library.',
    photoUrl: 'https://cdn.example.com/a.png',
    photoPosition: 'bottom' as const,
    buttonLabel: 'RSVP',
    buttonUrl: 'https://example.com/rsvp',
  }
  const draft = (overrides: Partial<EmailDraft> = {}): EmailDraft => ({
    id: 7,
    status: 'draft',
    goal: 'Introduce myself to voters',
    layout: '',
    theme: '',
    subject: '',
    headline: null,
    body: '',
    imageUrl: null,
    buttonLabel: null,
    buttonUrl: null,
    paidForBy: null,
    date: new Date('2026-10-30T15:00:00').toISOString(),
    voterFileFilterId: 3,
    recipientCount: 0,
    content: toContent(compose),
    ...overrides,
  })

  it('fills every step back in and opens on review when nothing is missing', () => {
    const loaded = loadEmailDraft(draft(), WIN_EMAIL_SURFACE, now)
    expect(loaded.step).toBe('review')
    expect(loaded.goalId).toBe('introduce_myself')
    expect(loaded.customGoal).toBe('')
    expect(loaded.compose).toEqual(compose)
    expect(loaded.listId).toBe(3)
    expect(loaded.timeSlot).toBe('15:00')
    expect(loaded.customTime).toBe('')
  })

  it('reads a goal that is no preset as a custom one', () => {
    const loaded = loadEmailDraft(
      draft({ goal: 'Thank my volunteers' }),
      WIN_EMAIL_SURFACE,
      now,
    )
    expect(loaded.goalId).toBe('custom')
    expect(loaded.customGoal).toBe('Thank my volunteers')
  })

  it('puts a time off the hour in Custom time', () => {
    const loaded = loadEmailDraft(
      draft({ date: new Date('2026-10-30T15:20:00').toISOString() }),
      WIN_EMAIL_SURFACE,
      now,
    )
    expect(loaded.timeSlot).toBe('custom')
    expect(loaded.customTime).toBe('15:20')
  })

  it('treats a send time that has passed as sending once paid', () => {
    const loaded = loadEmailDraft(
      draft({ date: new Date('2026-10-27T15:00:00').toISOString() }),
      WIN_EMAIL_SURFACE,
      now,
    )
    expect(loaded.timeSlot).toBe('now')
    expect(loaded.step).toBe('schedule')
    expect(
      checkScheduleSlot(loaded.sendDate, loaded.timeSlot, '', now),
    ).toEqual({ ok: true, iso: undefined })
  })

  it('opens on the first step that is not done', () => {
    const at = (overrides: Partial<EmailDraft>) =>
      loadEmailDraft(draft(overrides), WIN_EMAIL_SURFACE, now).step
    expect(at({ goal: '' })).toBe('goal')
    expect(at({ voterFileFilterId: null })).toBe('audience')
    expect(at({ content: toContent({ ...compose, message: '' }) })).toBe(
      'write',
    )
    expect(at({ content: toContent({ ...compose, buttonUrl: '' }) })).toBe(
      'look',
    )
    expect(at({ date: null })).toBe('schedule')
    // As an upload in the flow saves it: a list and nothing written.
    expect(
      at({
        date: null,
        content: toContent({ ...initialCompose(), layout: 'personal_letter' }),
      }),
    ).toBe('write')
  })
})
