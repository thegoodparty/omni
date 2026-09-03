import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { RoutePayloadTarget } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import DoNotKnockControl from './DoNotKnockControl'

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
  knockStatus: 'unknown',
  mayHaveMoved: false,
  doNotKnock: false,
  ...overrides,
})

const undoButton = () => screen.getByRole('button', { name: 'Undo' })

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
})

describe('DoNotKnockControl', () => {
  // The design's door carries no "Don't knock again", so this control no
  // longer sets the flag — it explains a door that is already flagged, and a
  // resident who isn't has nothing here to read.
  it('draws nothing for a resident who is not flagged', () => {
    render(<DoNotKnockControl target={target()} onChanged={vi.fn()} />)

    expect(screen.queryByText('Do not knock')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // A mis-press on a phone in the rain is foreseeable, and the alternative is
  // opening the CRM to undo something done at a doorstep.
  it('clears a flag in one tap', async () => {
    const onChanged = vi.fn()
    api.mock('POST /v1/door-knocking/do-not-knock', {
      status: 200,
      data: { personId: 'person-1', doNotKnock: false },
    })
    render(
      <DoNotKnockControl
        target={target({ doNotKnock: true })}
        onChanged={onChanged}
      />,
    )

    expect(screen.getByText('Do not knock')).toBeInTheDocument()
    fireEvent.click(undoButton())

    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith('person-1', false),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.DoorKnocking.DoNotKnockCleared,
    )
  })

  it('sends cleared when undoing', async () => {
    const sent: unknown[] = []
    api.mock('POST /v1/door-knocking/do-not-knock', ({ body }) => {
      sent.push(body)
      return { status: 200, data: { personId: 'person-1', doNotKnock: false } }
    })
    render(
      <DoNotKnockControl
        target={target({ doNotKnock: true })}
        onChanged={vi.fn()}
      />,
    )

    fireEvent.click(undoButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ stopTargetId: 21, value: 'cleared' })
  })

  it('says so when the write fails, and does not report a change', async () => {
    const onChanged = vi.fn()
    api.mock('POST /v1/door-knocking/do-not-knock', {
      status: 500,
      data: { message: 'nope' },
    })
    render(
      <DoNotKnockControl
        target={target({ doNotKnock: true })}
        onChanged={onChanged}
      />,
    )

    fireEvent.click(undoButton())

    await waitFor(() =>
      expect(screen.getByText(/didn.t save/i)).toBeInTheDocument(),
    )
    expect(onChanged).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
