import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RoutePayloadTarget } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import RecordKnockForm from './RecordKnockForm'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// Stand in for the shared dictation hook so a transcript can be delivered
// without the real getUserMedia / WebSocket / AudioWorklet stack.
const mocks = vi.hoisted(() => ({
  input: {
    current: null as null | {
      analyticsLabel: string
      value: string
      onChange: (next: string) => void
    },
  },
}))

vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: (input: {
    analyticsLabel: string
    value: string
    onChange: (next: string) => void
  }) => {
    mocks.input.current = input
    return {
      status: 'idle',
      error: null,
      partialTranscript: '',
      active: false,
      busy: false,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    }
  },
}))

const target: RoutePayloadTarget = {
  stopTargetId: 21,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: null,
  cellPhone: null,
  landline: null,
  knockStatus: 'unknown',
  mayHaveMoved: false,
  doNotKnock: false,
}

// What the hook does when a final transcript lands: hand back the whole
// next value for the field.
const dictate = (text: string) => act(() => mocks.input.current?.onChange(text))

const renderForm = (onRecorded = vi.fn()) => {
  render(
    <RecordKnockForm
      target={target}
      clientKey="6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90"
      onRecorded={onRecorded}
    />,
  )
  return onRecorded
}

// The answers to one question, so the two three-way rows that both offer
// "Yes" can be told apart.
const question = (label: string) =>
  within(screen.getByText(label).parentElement as HTMLElement)

const answer = (label: string, option: string) =>
  fireEvent.click(question(label).getByRole('radio', { name: option }))

// The walkthrough as far as a canvasser who had a conversation goes.
const walkToEngaged = () => {
  answer('Did they answer?', 'Answered')
  answer('Did they engage?', 'Engaged')
}

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
  mocks.input.current = null
  api.mock('POST /v1/door-knocking/interactions', {
    status: 200,
    data: { personId: 'person-1', knockStatus: 'not_home' },
  })
})

// The walkthrough is the form. Nothing about it is behind a disclosure, and
// the questions asked depend on where the last answer led.
describe('RecordKnockForm walkthrough', () => {
  it('opens on the outcome question, with no disclosure to find', () => {
    renderForm()

    const outcome = question('Did they answer?')
    expect(outcome.getByRole('radio', { name: 'Answered' })).toBeVisible()
    expect(outcome.getByRole('radio', { name: 'Not home' })).toBeVisible()
    expect(outcome.getByRole('radio', { name: 'Inaccessible' })).toBeVisible()

    // Nothing further is asked until the first answer says there is more to ask.
    expect(screen.queryByText('Did they engage?')).toBeNull()
    expect(screen.queryByText('Do they support you?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('asks whether they engaged once the door answered', () => {
    renderForm()
    answer('Did they answer?', 'Answered')

    const engagement = question('Did they engage?')
    expect(engagement.getByRole('radio', { name: 'Engaged' })).toBeVisible()
    expect(engagement.getByRole('radio', { name: 'Refused' })).toBeVisible()
    expect(engagement.getByRole('radio', { name: 'Not voter' })).toBeVisible()
  })

  // The panel expands downward: a question already answered stays on screen,
  // because the answer a canvasser wants to check before saving is the one
  // they gave two taps ago.
  it('keeps every answered question on screen as the walk expands', () => {
    renderForm()
    walkToEngaged()

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    answer('Do they support you?', 'Yes')
    expect(screen.getByText('Will they vote this election?')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    answer('Will they vote this election?', 'Yes')

    expect(screen.getByText('Did they answer?')).toBeVisible()
    expect(screen.getByText('Did they engage?')).toBeVisible()
    expect(screen.getByText('Do they support you?')).toBeVisible()
    expect(screen.getByText('Note')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible()
  })

  // An outcome with nothing left to ask is a finished record, so its Save
  // arrives with the answer rather than three questions later.
  it('offers Save as soon as a branch has nothing left to ask', () => {
    renderForm()

    answer('Did they answer?', 'Not home')
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible()
    expect(screen.queryByText('Did they engage?')).toBeNull()
  })

  it('offers Save on an answered door that would not engage', () => {
    renderForm()
    answer('Did they answer?', 'Answered')
    answer('Did they engage?', 'Refused')

    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible()
    expect(screen.queryByText('Do they support you?')).toBeNull()
  })

  // Tapping the chosen answer again clears it, and everything it opened goes
  // with it — the correction for a mis-tap three questions back.
  it('collapses the follow-ups when an answer is tapped off', () => {
    renderForm()
    walkToEngaged()
    answer('Do they support you?', 'Yes')
    expect(screen.getByText('Will they vote this election?')).toBeVisible()

    answer('Do they support you?', 'Yes')

    expect(screen.queryByText('Will they vote this election?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('returns to the first question when the walk is cancelled', () => {
    renderForm()
    walkToEngaged()
    answer('Do they support you?', 'Yes')
    answer('Will they vote this election?', 'Yes')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Did they answer?')).toBeVisible()
    expect(screen.queryByText('Did they engage?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('RecordKnockForm saving', () => {
  it('sends the engaged branch as an answered outcome with both answers', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'supporter' },
      }
    })
    const onRecorded = renderForm()

    walkToEngaged()
    answer('Do they support you?', 'Yes')
    answer('Will they vote this election?', 'Unsure')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      stopTargetId: 21,
      clientKey: '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90',
      outcome: 'answered',
      supportAnswer: 'supporter',
      willVote: 'unsure',
    })
    expect(onRecorded).toHaveBeenCalledWith('person-1', 'supporter')
  })

  // The second question is what the door ends as: step one's `answered` was
  // only the branch into it, and must never reach the contract.
  it('sends the engagement answer as the outcome', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'refused' },
      }
    })
    renderForm()

    answer('Did they answer?', 'Answered')
    answer('Did they engage?', 'Refused')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ outcome: 'refused_to_engage' })
    expect(posted[0]).not.toHaveProperty('supportAnswer')
    expect(posted[0]).not.toHaveProperty('willVote')
  })

  // The contract rejects answers on a non-answered outcome, so backing out of
  // the engaged branch must take the answers picked inside it with them.
  it('never sends answers picked before backing out of the engaged branch', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })
    renderForm()

    walkToEngaged()
    answer('Do they support you?', 'Yes')
    answer('Will they vote this election?', 'Yes')
    answer('Did they answer?', 'Not home')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ outcome: 'not_home' })
    expect(posted[0]).not.toHaveProperty('supportAnswer')
    expect(posted[0]).not.toHaveProperty('willVote')
  })

  it('reports the door without saying what the note said', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'supporter' },
    })
    renderForm()

    walkToEngaged()
    answer('Do they support you?', 'Yes')
    answer('Will they vote this election?', 'Yes')
    fireEvent.change(screen.getByPlaceholderText('Notes (optional)'), {
      target: { value: 'Marisol said her landlord is the problem' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
        outcome: 'answered',
        knockStatus: 'supporter',
        hasNote: true,
        supportAnswer: 'supporter',
        willVote: 'yes',
      }),
    )
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain(
      'Marisol',
    )
  })

  // A failed save must not advance or clear, or the door is silently lost.
  it('keeps the canvasser here when the save fails', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 500,
      data: { message: 'nope' },
    })
    const onRecorded = renderForm()

    answer('Did they answer?', 'Not home')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByText(/Saving failed/)).toBeInTheDocument(),
    )
    expect(onRecorded).not.toHaveBeenCalled()
    expect(
      question('Did they answer?').getByRole('radio', { name: 'Not home' }),
    ).toHaveAttribute('data-state', 'on')
  })
})

// The note lives at the end of the engaged branch, which is the only door
// with a conversation to write down.
describe('RecordKnockForm dictation', () => {
  const walkToNote = () => {
    renderForm()
    walkToEngaged()
    answer('Do they support you?', 'Yes')
    answer('Will they vote this election?', 'Yes')
  }

  it('offers dictation on the notes field', () => {
    walkToNote()

    expect(
      screen.getByRole('button', { name: 'Dictate note' }),
    ).toBeInTheDocument()
    expect(mocks.input.current?.analyticsLabel).toBe('door_knocking_note')
  })

  it('saves a dictated note', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'supporter' },
      }
    })

    walkToNote()
    dictate('Open to talking again next week')

    expect(screen.getByPlaceholderText('Notes (optional)')).toHaveValue(
      'Open to talking again next week',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      note: 'Open to talking again next week',
    })
  })

  // The textarea's maxLength only constrains typing, so a long dictation
  // would otherwise sail past the contract's 2,000-character ceiling and be
  // rejected on save.
  it('trims a dictation that runs past the note ceiling', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'supporter' },
      }
    })

    walkToNote()
    dictate('a'.repeat(2_500))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect((posted[0] as { note: string }).note).toHaveLength(2_000)
  })
})
