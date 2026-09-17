import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { RoutePayloadTarget } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import NotAVoterControl from './NotAVoterControl'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const target = (
  overrides: Partial<RoutePayloadTarget> = {},
): RoutePayloadTarget => ({
  stopTargetId: 21,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: null,
  cellPhone: null,
  landline: null,
  knockStatus: 'not_a_voter',
  mayHaveMoved: false,
  doNotKnock: false,
  ...overrides,
})

const movedButton = () => screen.getByRole('button', { name: 'Moved' })
const deceasedButton = () => screen.getByRole('button', { name: 'Deceased' })
const undoButton = () => screen.getByRole('button', { name: 'Undo' })

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
})

describe('NotAVoterControl follow-up', () => {
  // The outcome ships without a reason on purpose, so the question is only ever
  // asked about a door that is already recorded — never as a step on the way to
  // recording one.
  it('asks nothing until the door is logged as not a voter', () => {
    const { container } = render(
      <NotAVoterControl
        target={target({ knockStatus: 'unknown' })}
        onChanged={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('says the answer is optional, because the door is already saved', () => {
    render(<NotAVoterControl target={target()} onChanged={vi.fn()} />)

    expect(screen.getByText('Not a voter — what happened?')).toBeInTheDocument()
    expect(
      screen.getByText('Optional — this door is already logged.'),
    ).toBeInTheDocument()
  })

  it('posts the chosen reason against the stop target', async () => {
    const sent: unknown[] = []
    api.mock('POST /v1/door-knocking/not-a-voter', ({ body }) => {
      sent.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', notAVoterReason: 'moved' },
      }
    })
    const onChanged = vi.fn()
    render(<NotAVoterControl target={target()} onChanged={onChanged} />)

    fireEvent.click(movedButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ stopTargetId: 21, value: 'moved' })
    expect(onChanged).toHaveBeenCalledWith('person-1', 'moved')
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.NotAVoterReasonSet,
      { reason: 'moved' },
    )
  })

  // The whole point of a reason rather than a boolean: the two answers are told
  // apart everywhere downstream, starting with what was written.
  it('posts deceased as its own reason', async () => {
    const sent: unknown[] = []
    api.mock('POST /v1/door-knocking/not-a-voter', ({ body }) => {
      sent.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', notAVoterReason: 'deceased' },
      }
    })
    render(<NotAVoterControl target={target()} onChanged={vi.fn()} />)

    fireEvent.click(deceasedButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ stopTargetId: 21, value: 'deceased' })
  })

  // Reflecting the tap would leave the sheet claiming a person was flagged when
  // the request never landed — and this is the flag that suppresses them from
  // every future route.
  it('reports the echoed reason, not the one tapped', async () => {
    const onChanged = vi.fn()
    api.mock('POST /v1/door-knocking/not-a-voter', {
      status: 200,
      // An earlier visit already recorded `deceased`; the server is what knows.
      data: { personId: 'person-1', notAVoterReason: 'deceased' },
    })
    render(<NotAVoterControl target={target()} onChanged={onChanged} />)

    fireEvent.click(movedButton())

    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith('person-1', 'deceased'),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.NotAVoterReasonSet,
      { reason: 'deceased' },
    )
  })

  it('says so when the write fails, and reports no change', async () => {
    const onChanged = vi.fn()
    api.mock('POST /v1/door-knocking/not-a-voter', {
      status: 500,
      data: { message: 'nope' },
    })
    render(<NotAVoterControl target={target()} onChanged={onChanged} />)

    fireEvent.click(deceasedButton())

    await waitFor(() =>
      expect(screen.getByText(/didn.t save/i)).toBeInTheDocument(),
    )
    expect(onChanged).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})

describe('NotAVoterControl marker', () => {
  // "Moved away" only has to explain why the door is dropped. "Deceased" is
  // read at a door the rest of the household still answers, so it has to carry
  // an instruction, not just a fact.
  it('words a mover and a death differently', () => {
    const { unmount } = render(
      <NotAVoterControl
        target={target({ notAVoterReason: 'moved' })}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Moved away')).toBeInTheDocument()
    expect(
      screen.getByText(/no longer lives at this address/),
    ).toBeInTheDocument()
    unmount()

    render(
      <NotAVoterControl
        target={target({ notAVoterReason: 'deceased' })}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Deceased')).toBeInTheDocument()
    expect(screen.getByText(/do not ask for them by name/)).toBeInTheDocument()
  })

  // Neither marker asserts what happened, because neither is known: one is what
  // somebody said at a door, the other is a flag on a record. The deceased one
  // is read in front of the household, which is the worst place to be told a
  // relative is dead by a phone that only knows a checkbox.
  it('reports both flags as flags, never as facts', () => {
    const { unmount } = render(
      <NotAVoterControl
        target={target({ notAVoterReason: 'deceased' })}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText(/is marked as deceased/)).toBeInTheDocument()
    expect(screen.queryByText(/has died/)).not.toBeInTheDocument()
    unmount()

    render(
      <NotAVoterControl
        target={target({ notAVoterReason: 'moved' })}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText(/^Someone here said/)).toBeInTheDocument()
  })

  // A mis-tapped Deceased sits one button away from Moved, so the correction
  // costs the same one tap the mistake did.
  it('lifts a flag in one tap and reflects the cleared echo', async () => {
    const sent: unknown[] = []
    api.mock('POST /v1/door-knocking/not-a-voter', ({ body }) => {
      sent.push(body)
      // `cleared` comes back as an absent reason, the same way the route
      // payload spells "not flagged".
      return { status: 200, data: { personId: 'person-1' } }
    })
    const onChanged = vi.fn()
    render(
      <NotAVoterControl
        target={target({ notAVoterReason: 'deceased' })}
        onChanged={onChanged}
      />,
    )

    fireEvent.click(undoButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ stopTargetId: 21, value: 'cleared' })
    expect(onChanged).toHaveBeenCalledWith('person-1', undefined)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.NotAVoterReasonCleared,
    )
  })

  it('keeps the marker when undoing fails', async () => {
    const onChanged = vi.fn()
    api.mock('POST /v1/door-knocking/not-a-voter', { status: 500, data: {} })
    render(
      <NotAVoterControl
        target={target({ notAVoterReason: 'deceased' })}
        onChanged={onChanged}
      />,
    )

    fireEvent.click(undoButton())

    await waitFor(() =>
      expect(screen.getByText(/didn.t save/i)).toBeInTheDocument(),
    )
    expect(screen.getByText('Deceased')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
