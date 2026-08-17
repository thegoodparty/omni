import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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

vi.mock('app/dashboard/briefings/shared/useDictationAppend', () => ({
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

// Every test here is about the notes field, which lives on the detail path —
// the two-tap chips deliberately have nowhere to put a note.
const renderForm = () => {
  const result = render(
    <RecordKnockForm
      target={target}
      clientKey="6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90"
      onRecorded={vi.fn()}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Add a note or more detail' }),
  )
  return result
}

describe('RecordKnockForm dictation', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
    mocks.input.current = null
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_home' },
    })
  })

  it('offers dictation on the notes field', () => {
    renderForm()

    expect(
      screen.getByRole('button', { name: 'Dictate note' }),
    ).toBeInTheDocument()
  })

  it('saves a dictated note', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    renderForm()
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    dictate('Dog in the yard, come back Saturday')

    expect(screen.getByPlaceholderText('Notes (optional)')).toHaveValue(
      'Dog in the yard, come back Saturday',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      note: 'Dog in the yard, come back Saturday',
    })
  })

  // Dictation must not widen what a knock reports. Notes are free text about
  // a named voter, so only their existence travels — and the dictation
  // events the shared hook fires are labelled by surface, never by person.
  it('still reports only that a note exists', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    dictate('Marisol said her landlord is the problem')
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
        outcome: 'not_home',
        knockStatus: 'not_home',
        hasNote: true,
        logMode: 'detail',
      }),
    )
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain(
      'Marisol',
    )
    expect(mocks.input.current?.analyticsLabel).toBe('door_knocking_note')
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
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    renderForm()
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    dictate('a'.repeat(2_500))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect((posted[0] as { note: string }).note).toHaveLength(2_000)
  })
})

// The brief asks for two-tap capture. One of those taps opens the door's
// sheet, so exactly one tap inside this form has to be enough to save.
describe('RecordKnockForm quick capture', () => {
  const renderQuick = (onRecorded = vi.fn()) => {
    render(
      <RecordKnockForm
        target={target}
        clientKey="6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90"
        onRecorded={onRecorded}
      />,
    )
    return onRecorded
  }

  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
  })

  it('saves on the first tap, with no second confirming press', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })
    const onRecorded = renderQuick()

    // No 'Save knock' anywhere on the quick path — its absence is the point.
    expect(
      screen.queryByRole('button', { name: 'Save knock' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      stopTargetId: 21,
      clientKey: '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90',
      outcome: 'not_home',
    })
    expect(onRecorded).toHaveBeenCalledWith('person-1', 'not_home')
  })

  // A chip carries a complete result, so an answered door's support answer
  // rides along on the same single tap.
  it('sends the support answer folded into an answered chip', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'supporter' },
      }
    })
    renderQuick()

    fireEvent.click(screen.getByRole('button', { name: 'Supporter' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      outcome: 'answered',
      supportAnswer: 'supporter',
    })
  })

  // The contract rejects answers on a non-answered outcome, so a chip that
  // isn't "answered" must not smuggle one through.
  it('sends no support answer with an unanswered chip', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'refused' },
      }
    })
    renderQuick()

    fireEvent.click(screen.getByRole('button', { name: 'Refused' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).not.toHaveProperty('supportAnswer')
    expect(posted[0]).not.toHaveProperty('willVote')
  })

  it('reports which path logged the door', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_home' },
    })
    renderQuick()

    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
        outcome: 'not_home',
        knockStatus: 'not_home',
        hasNote: false,
        logMode: 'quick',
      }),
    )
  })

  // A failed save must not advance or clear, or the door is silently lost.
  it('keeps the canvasser here when the save fails', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 500,
      data: { message: 'nope' },
    })
    const onRecorded = renderQuick()

    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

    await waitFor(() =>
      expect(screen.getByText(/Saving failed/)).toBeInTheDocument(),
    )
    expect(onRecorded).not.toHaveBeenCalled()
  })
})
