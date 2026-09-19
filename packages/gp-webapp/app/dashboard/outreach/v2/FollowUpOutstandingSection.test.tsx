import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { FollowUpOutstandingSection } from './FollowUpOutstandingSection'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

const mockedUseOrganization = vi.mocked(useOrganization)
const mockedUseSnackbar = vi.mocked(useSnackbar)

const errorSnackbar = vi.fn()
const successSnackbar = vi.fn()
const displaySnackbar = vi.fn()

const OUTREACH_ID = 42

describe('<FollowUpOutstandingSection>', () => {
  beforeEach(() => {
    mockedUseOrganization.mockReset()
    mockedUseSnackbar.mockReset()
    errorSnackbar.mockClear()
    successSnackbar.mockClear()
    displaySnackbar.mockClear()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUseOrganization.mockReturnValue({ slug: 'eo-org-1' } as any)
    mockedUseSnackbar.mockReturnValue({
      displaySnackbar,
      errorSnackbar,
      successSnackbar,
    })
  })

  const mockCount = (count: number) =>
    api.mock('POST /v1/contacts/count', { status: 200, data: { count } })

  it('asks for the people still owed a follow-up from this campaign, not everyone who said yes', async () => {
    let body: Record<string, unknown> | null = null
    api.mock('POST /v1/contacts/count', ({ body: requestBody }) => {
      body = requestBody as Record<string, unknown>
      return { status: 200, data: { count: 3 } }
    })

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
      />,
    )

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({
      followUpRequested: true,
      activityConditions: [
        { outreachType: 'phoneBanking', outreachId: OUTREACH_ID, actions: [] },
      ],
    })
  })

  it('shows the outstanding count as a labelled tile', async () => {
    mockCount(3)

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
      />,
    )

    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByText('Asked for follow-up')).toBeInTheDocument()
    expect(
      screen.getByText(
        'People who requested a follow-up during this outreach campaign',
      ),
    ).toBeInTheDocument()
  })

  it('shows a zero tile and no actions when nothing is outstanding', async () => {
    mockCount(0)

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
        onCallList={vi.fn()}
      />,
    )

    expect(await screen.findByText('0')).toBeInTheDocument()
    expect(screen.getByText('Asked for follow-up')).toBeInTheDocument()
    // The zero state differs from the non-zero one ONLY by the missing
    // buttons — pinned because the doc and the code drifted here once.
    expect(
      screen.getByText(
        'People who requested a follow-up during this outreach campaign',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('saves the audience as a list and hands it to the caller', async () => {
    const user = userEvent.setup()
    const onCallList = vi.fn()
    mockCount(3)
    let savedBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      savedBody = body as Record<string, unknown>
      return {
        status: 200,
        data: { id: 77, name: 'Tuesday calls — follow-ups' },
      }
    })

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
        onCallList={onCallList}
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Call them back' }),
    )

    await waitFor(() =>
      expect(onCallList).toHaveBeenCalledWith(77, 'Tuesday calls — follow-ups'),
    )
    expect(successSnackbar).toHaveBeenCalledWith(
      'Saved "Tuesday calls — follow-ups" to your lists.',
    )
    // The saved list carries the same audience the count was taken over, so
    // the call sheet cannot disagree with the number that prompted it.
    expect(savedBody).toMatchObject({
      followUpRequested: true,
      activityConditions: [
        { outreachType: 'phoneBanking', outreachId: OUTREACH_ID, actions: [] },
      ],
    })
  })

  // Working the list and then exporting it should not leave two identical
  // lists behind.
  it('reuses the list it already saved rather than creating a second', async () => {
    const user = userEvent.setup()
    mockCount(3)
    let createCalls = 0
    api.mock('POST /v1/voters/voter-file/filter', () => {
      createCalls += 1
      return {
        status: 200,
        data: { id: 77, name: 'Tuesday calls — follow-ups' },
      }
    })

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
        onCallList={vi.fn()}
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Call them back' }),
    )
    await waitFor(() => expect(createCalls).toBe(1))
    await user.click(screen.getByRole('button', { name: 'Save as list' }))
    await waitFor(() => expect(successSnackbar).toHaveBeenCalled())

    expect(createCalls).toBe(1)
    // Both paths report the save with the SAME string, from the one copy
    // object — an inline literal here would drift and, worse, would be
    // invisible to the vocabulary gate.
    expect(successSnackbar).toHaveBeenCalledWith(
      'Saved "Tuesday calls — follow-ups" to your lists.',
    )
  })

  // Both clicks dispatched in ONE tick, which is what a double-tap does and
  // what userEvent's awaited clicks cannot reproduce: React has not flushed
  // the re-render that disables the button, so a state-based guard lets both
  // through and saves the list twice.
  it('saves once when both taps land before React re-renders', async () => {
    mockCount(3)
    let createCalls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    api.mock('POST /v1/voters/voter-file/filter', async () => {
      createCalls += 1
      await gate
      return {
        status: 200,
        data: { id: 77, name: 'Tuesday calls — follow-ups' },
      }
    })

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
      />,
    )

    const button = await screen.findByRole('button', { name: 'Save as list' })
    fireEvent.click(button)
    fireEvent.click(button)
    release?.()

    await waitFor(() => expect(successSnackbar).toHaveBeenCalled())
    expect(createCalls).toBe(1)
  })

  it('refreshes the lists caches so the saved list is findable', async () => {
    const user = userEvent.setup()
    mockCount(3)
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 77, name: 'Tuesday calls — follow-ups' },
    })
    const invalidate = vi.spyOn(testQueryClient, 'invalidateQueries')

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Save as list' }),
    )
    await waitFor(() => expect(successSnackbar).toHaveBeenCalled())

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey?.[0])
    expect(keys).toContain('custom-segments')
    expect(keys).toContain('outreach-audience-lists')
    invalidate.mockRestore()
  })

  it('offers no call action when the caller cannot open a flow', async () => {
    mockCount(3)

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
      />,
    )

    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Call them back' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save as list' })).toBeVisible()
  })

  // Two buttons over an unknown audience is a worse affordance than none.
  it('renders nothing when the count cannot be resolved', async () => {
    api.mock('POST /v1/contacts/count', { status: 500, data: { message: 'x' } })

    const { container } = render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
        onCallList={vi.fn()}
      />,
    )

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  // Both taps share one in-flight promise, but each mutateAsync() wires its
  // own onError — so a single network failure must still be reported once.
  it('reports a failed save once when both taps land before React re-renders', async () => {
    mockCount(3)
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 500,
      data: { message: 'boom' },
    })

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
      />,
    )

    const button = await screen.findByRole('button', { name: 'Save as list' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(errorSnackbar).toHaveBeenCalledTimes(1)
  })

  it('surfaces a save failure instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    const onCallList = vi.fn()
    mockCount(3)
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 500,
      data: { message: 'boom' },
    })

    render(
      <FollowUpOutstandingSection
        outreachId={OUTREACH_ID}
        outreachName="Tuesday calls"
        onCallList={onCallList}
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: 'Call them back' }),
    )

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalledTimes(1))
    expect(onCallList).not.toHaveBeenCalled()
  })
})
