import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { format } from 'date-fns'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import { useWinVoterContext } from '../../../shared/useWinVoterContext'
import { useOrganization } from '@shared/organization-picker'
import LogInteraction from './LogInteraction'
import type { LogContactInteractionResponse } from '../shared/contacts-types'

vi.mock('../../../shared/useCrmEnabled', () => ({
  useCrmEnabled: vi.fn(),
}))

vi.mock('../../../shared/useWinVoterContext', () => ({
  useWinVoterContext: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockedUseCrmEnabled = vi.mocked(useCrmEnabled)
const mockedUseWinVoterContext = vi.mocked(useWinVoterContext)
const mockedUseOrganization = vi.mocked(useOrganization)

const PERSON_ID = 'p_1'

const makeLoggedResponse = (
  overrides: Partial<LogContactInteractionResponse> = {},
): LogContactInteractionResponse =>
  ({
    id: 'interaction_1',
    personId: PERSON_ID,
    channel: 'doorKnock',
    outcome: 'answered',
    supportAnswer: 'supporter',
    occurredAt: new Date('2026-07-01T12:00:00.000Z'),
    note: null,
    manual: true,
    ...overrides,
  }) as LogContactInteractionResponse

describe('<LogInteraction>', () => {
  beforeEach(() => {
    mockedUseCrmEnabled.mockReset()
    mockedUseWinVoterContext.mockReset()
    mockedUseOrganization.mockReset()
    vi.mocked(trackEvent).mockClear()

    mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUseOrganization.mockReturnValue({ slug: 'org-1' } as any)
  })

  it('does not render when the CRM flag is off', () => {
    mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: false })

    const { container } = render(<LogInteraction personId={PERSON_ID} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('does not render while the CRM gate is not ready', () => {
    mockedUseCrmEnabled.mockReturnValue({ ready: false, enabled: false })

    const { container } = render(<LogInteraction personId={PERSON_ID} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the text outcome options and hides the support-answer field for the text channel', async () => {
    const user = userEvent.setup()
    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Text' }))

    expect(
      screen.getByRole('radio', { name: 'No Outcome' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Responded' })).toBeInTheDocument()
    expect(screen.queryByText('Support')).not.toBeInTheDocument()
    // opted_out is a valid API outcome but stays out of the manual form.
    expect(
      screen.queryByRole('radio', { name: /opted.?out/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the door-knock outcome and support-answer options', async () => {
    const user = userEvent.setup()
    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Door Knock' }))

    expect(screen.getByRole('radio', { name: 'Answered' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Not Home' })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'Refused to Engage' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Unsure' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No' })).toBeInTheDocument()
  })

  it('shows the robocall outcome options and hides the support-answer field', async () => {
    const user = userEvent.setup()
    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))

    expect(screen.getByRole('radio', { name: 'Answered' })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'Voicemail Left' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Support')).not.toBeInTheDocument()
  })

  it('disables submit until an outcome is chosen for door knock, but not for text', async () => {
    const user = userEvent.setup()
    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Door Knock' }))
    expect(
      screen.getByRole('button', { name: 'Log Interaction' }),
    ).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    expect(
      screen.getByRole('button', { name: 'Log Interaction' }),
    ).toBeEnabled()

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    // Text defaults to "No Outcome" selected — valid without further input.
    expect(
      screen.getByRole('button', { name: 'Log Interaction' }),
    ).toBeEnabled()
  })

  it('logs a door-knock interaction, invalidates the feed and person queries, and fires the Win Contact Logged event once', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: true, isReady: true })
    const user = userEvent.setup()
    const receivedBodies: unknown[] = []
    api.mock('POST /v1/contacts/:personId/interactions', ({ body }) => {
      receivedBodies.push(body)
      return {
        status: 200,
        data: makeLoggedResponse(
          body as Partial<LogContactInteractionResponse>,
        ),
      }
    })
    const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries')

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Door Knock' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() => expect(trackEvent).toHaveBeenCalled())
    expect(receivedBodies).toHaveLength(1)
    expect(receivedBodies[0]).toMatchObject({
      channel: 'doorKnock',
      outcome: 'answered',
      supportAnswer: 'supporter',
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['contact-engagement', 'activities'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['person', 'org-1', PERSON_ID],
    })

    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ContactLogged, {
      channel: 'doorKnock',
      outcome: 'answered',
      supportAnswer: 'supporter',
    })
  })

  it('sends no outcome when the text outcome toggle is deselected', async () => {
    const user = userEvent.setup()
    const receivedBodies: unknown[] = []
    api.mock('POST /v1/contacts/:personId/interactions', ({ body }) => {
      receivedBodies.push(body)
      return {
        status: 200,
        data: makeLoggedResponse(
          body as Partial<LogContactInteractionResponse>,
        ),
      }
    })

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    // Radix ToggleGroup deselect: clicking the pressed pill emits '' — the
    // payload must not fabricate a 'responded' outcome from that state.
    await user.click(screen.getByRole('radio', { name: 'No Outcome' }))
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() => expect(receivedBodies).toHaveLength(1))
    expect(receivedBodies[0]).toMatchObject({ channel: 'text' })
    expect(receivedBodies[0]).not.toHaveProperty('outcome')
  })

  it('omits occurredAt (defers to the server default of "now") when the date field is cleared', async () => {
    const user = userEvent.setup()
    const receivedBodies: unknown[] = []
    api.mock('POST /v1/contacts/:personId/interactions', ({ body }) => {
      receivedBodies.push(body)
      return {
        status: 200,
        data: makeLoggedResponse(
          body as Partial<LogContactInteractionResponse>,
        ),
      }
    })

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '' },
    })
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() => expect(receivedBodies).toHaveLength(1))
    expect(receivedBodies[0]).not.toHaveProperty('occurredAt')
  })

  it('omits occurredAt when the date field is explicitly set to today', async () => {
    const user = userEvent.setup()
    const receivedBodies: unknown[] = []
    api.mock('POST /v1/contacts/:personId/interactions', ({ body }) => {
      receivedBodies.push(body)
      return {
        status: 200,
        data: makeLoggedResponse(
          body as Partial<LogContactInteractionResponse>,
        ),
      }
    })

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: format(new Date(), 'yyyy-MM-dd') },
    })
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() => expect(receivedBodies).toHaveLength(1))
    expect(receivedBodies[0]).not.toHaveProperty('occurredAt')
  })

  it('sends occurredAt as local noon of a backdated log', async () => {
    const user = userEvent.setup()
    const receivedBodies: unknown[] = []
    api.mock('POST /v1/contacts/:personId/interactions', ({ body }) => {
      receivedBodies.push(body)
      return {
        status: 200,
        data: makeLoggedResponse(
          body as Partial<LogContactInteractionResponse>,
        ),
      }
    })

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-07-01' },
    })
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() => expect(receivedBodies).toHaveLength(1))
    const body = receivedBodies[0] as { occurredAt: string }
    // Dates serialize to ISO on the wire; local noon keeps the calendar day
    // stable across every real-world timezone offset.
    expect(body.occurredAt).toBe(new Date('2026-07-01T12:00:00').toISOString())
  })

  it('fires the Serve Contact Logged event with the same properties as Win', async () => {
    mockedUseWinVoterContext.mockReturnValue({ isWin: false, isReady: true })
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/:personId/interactions', ({ body }) => ({
      status: 200,
      data: makeLoggedResponse(body as Partial<LogContactInteractionResponse>),
    }))

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Door Knock' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    await user.click(screen.getByRole('radio', { name: 'Unsure' }))
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() => expect(trackEvent).toHaveBeenCalled())
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.ContactLogged,
      { channel: 'doorKnock', outcome: 'answered', supportAnswer: 'unsure' },
    )
  })

  it('omits supportAnswer from the Contact Logged properties for a text log', async () => {
    const user = userEvent.setup()
    const textResponse: LogContactInteractionResponse = {
      id: 'interaction_2',
      personId: PERSON_ID,
      channel: 'text',
      outcome: 'responded',
      occurredAt: new Date('2026-07-01T12:00:00.000Z'),
      note: null,
      manual: true,
    }
    api.mock('POST /v1/contacts/:personId/interactions', {
      status: 200,
      data: textResponse,
    })

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(screen.getByRole('radio', { name: 'Responded' }))
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() => expect(trackEvent).toHaveBeenCalled())
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.ContactLogged,
      { channel: 'text', outcome: 'responded' },
    )
  })

  it('clears the form after a successful submit', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/:personId/interactions', ({ body }) => ({
      status: 200,
      data: makeLoggedResponse(body as Partial<LogContactInteractionResponse>),
    }))

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    await user.type(screen.getByLabelText('Interaction note'), 'Left a note')
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Interaction note')).toHaveValue(''),
    )
    // Channel toggle resets to nothing selected — the outcome/support
    // sections (channel-dependent) disappear along with it.
    expect(
      screen.queryByRole('button', { name: 'Voicemail Left' }),
    ).not.toBeInTheDocument()
  })

  it('shows an inline error and fires no analytics when the log request fails', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/:personId/interactions', {
      status: 500,
      data: { message: 'boom' },
    })

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    expect(
      await screen.findByText(/couldn.t log this interaction/i),
    ).toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalled()
    // The channel selection (and the rest of the form) survives a failure so
    // the user can retry without re-entering everything.
    expect(screen.getByRole('radio', { name: 'Answered' })).toBeInTheDocument()
  })

  it('disables and shows a loading state on submit while the request is pending', async () => {
    const user = userEvent.setup()
    let resolveRequest: (() => void) | undefined
    api.mock(
      'POST /v1/contacts/:personId/interactions',
      () =>
        new Promise((resolve) => {
          resolveRequest = () =>
            resolve({ status: 200, data: makeLoggedResponse() })
        }),
    )

    render(<LogInteraction personId={PERSON_ID} />)

    await user.click(screen.getByRole('radio', { name: 'Robocall' }))
    await user.click(screen.getByRole('radio', { name: 'Answered' }))
    await user.click(screen.getByRole('button', { name: 'Log Interaction' }))

    const submitButton = screen.getByRole('button', {
      name: /log interaction/i,
    })
    expect(submitButton).toBeDisabled()
    expect(submitButton).toHaveAttribute('data-loading', 'true')

    resolveRequest?.()
    // The channel resets on success (form clears), which would also leave the
    // button disabled for an unrelated reason (no channel selected) — assert
    // on the loading flag specifically so this test isolates "is pending"
    // from "is a form-validity no-op".
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /log interaction/i }),
      ).toHaveAttribute('data-loading', 'false'),
    )
  })
})
