import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RoutePayloadTarget } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useServeIssueCaptureFlag } from 'app/shared/experiments/serveIssueCaptureFlag'
import RecordKnockForm from './RecordKnockForm'
import { DoorKnockingSurfaceProvider } from './doorKnockingSurface'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('app/shared/experiments/serveIssueCaptureFlag', () => ({
  useServeIssueCaptureFlag: vi.fn(),
}))

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

const MEMO = 'Bob is against the Flock cameras, wants the data deleted.'

const dictate = (text: string) => act(() => mocks.input.current?.onChange(text))

const question = (label: string) =>
  within(screen.getByText(label).parentElement as HTMLElement)

const answer = (label: string, option: string) =>
  fireEvent.click(question(label).getByRole('radio', { name: option }))

const renderForm = (onRecorded = vi.fn()) => {
  render(
    <DoorKnockingSurfaceProvider value={true}>
      <RecordKnockForm
        target={target}
        clientKey="6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90"
        onRecorded={onRecorded}
      />
    </DoorKnockingSurfaceProvider>,
  )
  return onRecorded
}

// A Serve door with a conversation and a dictated memo, saved.
const walkAndSave = async () => {
  answer('Did they answer?', 'Answered')
  answer('Did they engage?', 'Engaged')
  answer('Do they need follow-up?', 'Yes')
  dictate(MEMO)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
  vi.mocked(useServeIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: true,
  })
  mocks.input.current = null
  api.mock('POST /v1/door-knocking/interactions', {
    status: 200,
    data: { personId: 'person-1', knockStatus: 'needs_follow_up' },
  })
  api.mock('POST /v1/constituent-feedback', {
    status: 200,
    data: {
      id: 'feedback-1',
      personId: 'person-1',
      extractionStatus: 'extracted',
      extraction: {
        issueLabel: 'Flock cameras',
        stance: 'opposes',
        desiredOutcome: 'Remove them and delete the data',
      },
    },
  })
  api.mock('PATCH /v1/constituent-feedback/:id/confirm', {
    status: 200,
    data: {
      id: 'feedback-1',
      personId: 'person-1',
      occurredAt: new Date('2026-09-25T00:00:00.000Z'),
      channel: 'door_knock',
      transcript: MEMO,
      issueLabel: 'Flock cameras',
      stance: 'opposes',
      desiredOutcome: 'Remove them and delete the data',
      extractionStatus: 'extracted',
      confirmedAt: new Date('2026-09-25T00:00:01.000Z'),
      actorName: 'Kamal Al Sawafi',
    },
  })
})

describe('RecordKnockForm issue capture', () => {
  it('offers the extracted triple for confirmation instead of advancing', async () => {
    const onRecorded = renderForm()
    await walkAndSave()

    expect(await screen.findByText('Is this right?')).toBeVisible()
    expect(screen.getByDisplayValue('Flock cameras')).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Against it' })).toBeChecked()
    // The walk is held at this door until the triple is answered.
    expect(onRecorded).not.toHaveBeenCalled()
  })

  it('advances once the canvasser confirms', async () => {
    const onRecorded = renderForm()
    await walkAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
  })

  it('advances on skip, leaving the memo unconfirmed', async () => {
    const onRecorded = renderForm()
    await walkAndSave()

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentFeedback.IssueSkipped,
      { channel: 'doorKnocking' },
    )
  })

  // The knock has already saved by the time capture runs. Holding a canvasser
  // at a logged door because a second request failed is the worse outcome, so
  // a capture failure advances the walk rather than trapping it.
  it('advances anyway when capture fails', async () => {
    api.mock('POST /v1/constituent-feedback', {
      status: 500,
      data: { message: 'boom' },
    })
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  // Nothing about a constituent's words reaches analytics — only whether the
  // canvasser had to change what the model proposed.
  it('reports whether the proposal was corrected, never what it said', async () => {
    renderForm()
    await walkAndSave()

    const issue = await screen.findByDisplayValue('Flock cameras')
    fireEvent.change(issue, { target: { value: 'Surveillance cameras' } })
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ConstituentFeedback.IssueConfirmed,
        { channel: 'doorKnocking', corrected: true },
      ),
    )
  })

  // The note field is deliberately offered on every branch, including a
  // not-home door, so a note there is real and worth keeping — but it is not
  // a constituent's position and must not be extracted as one.
  it('saves a not-home note without capturing an issue from it', async () => {
    const onRecorded = renderForm()
    answer('Did they answer?', 'Not home')
    dictate('Dog in the yard, come back Saturday.')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(screen.queryByText('Is this right?')).toBeNull()
  })

  // react-query refreshes a mutation's callbacks every render, so `onSuccess`
  // runs against the latest closure — and the engagement pills stay live while
  // the knock is in flight. Re-tapping one must not retroactively decide the
  // memo already dictated should be thrown away.
  it('still captures when the engagement is re-tapped mid-save', async () => {
    // A deferred the mock awaits, so the knock is genuinely in flight when the
    // pill is tapped. Held in an object: a null-initialised local narrows to
    // `never` across the await.
    const gate: { release: () => void } = { release: () => undefined }
    const inFlight = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    let knockStarted = false
    api.mock('POST /v1/door-knocking/interactions', async () => {
      knockStarted = true
      await inFlight
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'needs_follow_up' },
      }
    })

    renderForm()
    await walkAndSave()
    await waitFor(() => expect(knockStarted).toBe(true))

    answer('Did they engage?', 'Refused')
    gate.release()

    expect(await screen.findByText('Is this right?')).toBeVisible()
  })

  it('does not capture when the flag is off', async () => {
    vi.mocked(useServeIssueCaptureFlag).mockReturnValue({
      ready: true,
      enabled: false,
    })
    const onRecorded = renderForm()
    await walkAndSave()

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('person-1', 'needs_follow_up'),
    )
    expect(screen.queryByText('Is this right?')).toBeNull()
  })
})
