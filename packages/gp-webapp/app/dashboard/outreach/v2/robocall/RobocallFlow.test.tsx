import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RobocallScriptDraftRequest } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { RobocallFlow } from './RobocallFlow'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// MediaRecorder / getUserMedia don't exist in jsdom, so replace the recorder
// hook with a light stateful fake that transitions the same idle -> recording
// -> preview -> saved states the UI keys off, without touching the DOM media
// APIs. Same tactic as the Calendar stub below.
vi.mock('./useRobocallRecorder', async () => {
  const { useState, useCallback } = await import('react')
  const clip = {
    blob: new Blob(['x'], { type: 'audio/webm' }),
    url: 'blob:mock',
    durationSec: 5,
  }
  return {
    useRobocallRecorder: () => {
      const [status, setStatus] = useState('idle')
      const [recording, setRecording] = useState<typeof clip | null>(null)
      // Stable identities: RobocallFlow's open-effect lists `reset` as a
      // dependency, so a fresh function each render would re-fire it every
      // render and blow the update-depth limit.
      const start = useCallback(() => setStatus('recording'), [])
      const stop = useCallback(() => {
        setRecording(clip)
        setStatus('preview')
      }, [])
      const discard = useCallback(() => {
        setRecording(null)
        setStatus('idle')
      }, [])
      const save = useCallback(() => setStatus('saved'), [])
      const reset = useCallback(() => {
        setRecording(null)
        setStatus('idle')
      }, [])
      return {
        status,
        elapsedSec: 0,
        recording,
        error: null,
        start,
        stop,
        discard,
        save,
        uploadFile: stop,
        reset,
      }
    },
  }
})

// useListWizardCount (reached only in the builder) reads the active org slug.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

// react-day-picker is impractical to drive in jsdom (same call the repo's
// ElectionResultPage test makes), so stub the styleguide Calendar to buttons
// that fire onSelect with a valid-future or too-soon date.
vi.mock('@styleguide', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@styleguide')>()
  return {
    ...actual,
    Calendar: ({ onSelect }: { onSelect: (day?: Date) => void }) => (
      <div>
        <button
          type="button"
          onClick={() => onSelect(new Date(Date.now() + 60 * 86_400_000))}
        >
          mock-pick-future
        </button>
        <button
          type="button"
          onClick={() => onSelect(new Date(Date.now() - 10 * 86_400_000))}
        >
          mock-pick-past
        </button>
      </div>
    ),
  }
})

// The CRM wizard's dumb steps have their own tests; stub them to light
// stand-ins so this test can drive RobocallFlow's builder path without
// coupling to the wizard's pill/label internals.
vi.mock('app/dashboard/contacts/crm/wizard/VoterFileStep', () => ({
  default: ({
    onSupportStatusChange,
  }: {
    onSupportStatusChange: (v: string[]) => void
  }) => (
    <button type="button" onClick={() => onSupportStatusChange(['supporter'])}>
      mock-add-filter
    </button>
  ),
}))
vi.mock('app/dashboard/contacts/crm/wizard/NameStep', () => ({
  default: ({
    name,
    onNameChange,
  }: {
    name: string
    onNameChange: (n: string) => void
  }) => (
    <input
      aria-label="mock list name"
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
    />
  ),
}))

const mockSavedLists = () =>
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [
      { id: 1, name: 'Renters in 98103' },
      { id: 2, name: 'All registered voters' },
    ],
  })

// robocall reads the landline count off reachability.robocall.
const mockListDetail = (robocall: number | null) =>
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: {
      demographics: { people: 1000, avgAge: null, avgIncome: null },
      reachability: {
        sms: 500,
        robocall,
        phoneBanking: robocall,
        doorKnocking: 700,
        polls: 500,
      },
      outreachHistory: [],
    },
  })

const mockBuilderCount = (count: number) =>
  api.mock('POST /v1/contacts/count', { status: 200, data: { count } })

const mockCreateList = () =>
  api.mock('POST /v1/voters/voter-file/filter', {
    status: 200,
    data: { id: 99, name: 'My landline list' },
  })

const mockCreateListError = () =>
  api.mock('POST /v1/voters/voter-file/filter', {
    status: 500,
    data: { message: 'boom' },
  })

const mockDraft = (
  draft = 'Hi, this is Alex, and I am running for City Council.',
) =>
  api.mock('POST /v1/outreach/robocall/draft', {
    status: 200,
    data: { draft },
  })

const mockDraftError = () =>
  api.mock('POST /v1/outreach/robocall/draft', {
    status: 500,
    data: { message: 'boom' },
  })

// Entering compose rents a caller-ID number (the candidate reads it aloud);
// the draft fires only after the rent resolves.
const mockRentNumber = (phoneNumber = '+12025550147') =>
  api.mock('POST /v1/outreach/robocall/number', {
    status: 200,
    data: { phoneNumber, region: 'DC' },
  })

const mockRentNumberError = () =>
  api.mock('POST /v1/outreach/robocall/number', {
    status: 500,
    data: { message: 'boom' },
  })

// The compliance check fires once a recording is saved (uploaded). Default to
// a pass so the record-and-continue tests advance; override per test.
const mockCompliance = (passed = true, issues: string[] = []) =>
  api.mock('POST /v1/outreach/robocall/compliance', {
    status: 200,
    data: {
      passed,
      checks: {
        hasSelfIdentification: passed,
        hasOrganization: passed,
        hasCallbackNumber: passed,
      },
      transcript: 'Hi, this is Alex...',
      issues,
    },
  })

// The real endpoint returns 502 on a transcription/LLM failure; the UI just
// branches on isError, and 502 isn't in the typed mocker's status union, so a
// 500 stands in to drive the same error state.
const mockComplianceError = () =>
  api.mock('POST /v1/outreach/robocall/compliance', {
    status: 500,
    data: { message: 'transcription failed' },
  })

// Purpose -> audience -> schedule, then set a valid date+time and Continue into
// compose WITHOUT pre-mocking a successful draft, so the caller controls
// whether the on-entry draft succeeds or fails.
const gotoComposeRaw = async (purposeLabel = 'Persuade likely voters') => {
  await gotoSchedule(purposeLabel)
  await userEvent.click(screen.getByText('Pick a date'))
  await userEvent.click(await screen.findByText('mock-pick-future'))
  await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
  await userEvent.click(await screen.findByRole('option', { name: '10:00 AM' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

// Mocks the presign endpoint and stubs the direct S3 POST. `s3Ok` controls
// whether the upload succeeds; non-S3 requests fall through to MSW.
// Restore any global.fetch spy (mockAudioUpload) so it doesn't leak a
// neutered fetch into later tests.
afterEach(() => vi.restoreAllMocks())

const mockAudioUpload = (s3Ok = true) => {
  api.mock('POST /v1/outreach/robocall/audio/presign', {
    status: 200,
    data: {
      url: 'https://s3.example/robocall-audio-dev',
      fields: { key: 'k', 'Content-Type': 'audio/webm', policy: 'p' },
      key: 'robocall/42/clip.webm',
      expiresIn: 600,
    },
  })
  const realFetch = global.fetch
  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.includes('s3.example')) {
      return Promise.resolve(new Response(null, { status: s3Ok ? 204 : 500 }))
    }
    return realFetch(input, init)
  })
}

const gotoAudience = async (purposeLabel = 'Persuade likely voters') => {
  render(<RobocallFlow open onClose={vi.fn()} />)
  fireEvent.click(screen.getByText(purposeLabel))
}

// Purpose -> audience -> pick a saved list -> Continue, landing on the schedule
// ("When") step.
const gotoSchedule = async (purposeLabel = 'Persuade likely voters') => {
  mockSavedLists()
  mockListDetail(80)
  await gotoAudience(purposeLabel)
  await userEvent.click(await screen.findByText('Choose a voter list'))
  await userEvent.click(await screen.findByText('Renters in 98103'))
  await userEvent.click(
    await screen.findByRole('button', { name: /Continue \(80\)/ }),
  )
  await screen.findByLabelText('Campaign name')
}

// Schedule -> set a comfortably-future date + time -> Continue, landing on the
// compose ("What do you want to say?") step.
const gotoCompose = async (purposeLabel = 'Persuade likely voters') => {
  mockDraft()
  await gotoSchedule(purposeLabel)
  await userEvent.click(screen.getByText('Pick a date'))
  await userEvent.click(await screen.findByText('mock-pick-future'))
  await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
  await userEvent.click(await screen.findByRole('option', { name: '10:00 AM' }))
  const continueBtn = screen.getByRole('button', { name: 'Continue' })
  await waitFor(() => expect(continueBtn).toBeEnabled())
  await userEvent.click(continueBtn)
  // Compose-step landing: keyed on the Intro body (unique to this step; the
  // "What do you want to say?" title also renders in the sheet's a11y title).
  await screen.findByText(/Read the script below into your microphone/)
}

describe('RobocallFlow', () => {
  // useElectedOffice fires on mount (no enable guard); 404 => not an elected
  // official (data null), exercising the hook's real 404->null branch.
  beforeEach(() => {
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'No elected office' },
    })
    mockRentNumber()
    mockCompliance()
  })

  it('opens on the purpose step with the robocall purposes', () => {
    mockSavedLists()
    render(<RobocallFlow open onClose={vi.fn()} />)
    expect(screen.getByText('Introduce myself to voters')).toBeInTheDocument()
    expect(screen.getByText('Persuade likely voters')).toBeInTheDocument()
  })

  it('advances to the audience step when a purpose is selected', async () => {
    mockSavedLists()
    await gotoAudience()
    expect(
      screen.getByText(/We recommend reaching all your supporters/),
    ).toBeInTheDocument()
    // The reachable-count note under the picker (design flowWho).
    expect(
      screen.getByText(/may change based on the mode of outreach/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Introduce myself to voters'),
    ).not.toBeInTheDocument()
  })

  it('returns to the purpose step on Back from the audience picker', async () => {
    mockSavedLists()
    await gotoAudience()
    fireEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Introduce myself to voters')).toBeInTheDocument()
  })

  it('shows the landline reachable count and advances on Continue', async () => {
    mockSavedLists()
    mockListDetail(80)
    await gotoAudience()

    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))

    // 80 landline-reachable voters * $0.045 = $3.60
    expect(
      await screen.findByText(/Reach 80 supporters with landlines for \$3\.60/),
    ).toBeInTheDocument()

    const continueBtn = await screen.findByRole('button', {
      name: /Continue \(80\)/,
    })
    await userEvent.click(continueBtn)
    // Advancing lands on the schedule ("When") step, not the placeholder.
    expect(await screen.findByLabelText('Campaign name')).toBeInTheDocument()
  })

  it('disables Continue while the reachable count is loading', async () => {
    mockSavedLists()
    // Hold list-detail open so reachabilityQuery stays fetching and the
    // reachableLoading guard's window actually occurs (synchronous mocks would
    // resolve before it could).
    let releaseListDetail!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseListDetail = resolve
    })
    api.mock('GET /v1/contacts/list-detail', async () => {
      await gate
      return {
        status: 200,
        data: {
          demographics: { people: 1000, avgAge: null, avgIncome: null },
          reachability: {
            sms: 500,
            robocall: 80,
            phoneBanking: 80,
            doorKnocking: 700,
            polls: 500,
          },
          outreachHistory: [],
        },
      }
    })
    await gotoAudience()

    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))

    // Mid-fetch: the spinner shows and Continue must stay disabled.
    expect(
      await screen.findByText('Counting reachable voters…'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // Once it settles, the count appears and Continue enables.
    releaseListDetail()
    expect(
      await screen.findByRole('button', { name: /Continue \(80\)/ }),
    ).toBeEnabled()
  })

  it('treats a null landline count as unavailable, not zero', async () => {
    mockSavedLists()
    mockListDetail(null)
    await gotoAudience()

    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))

    expect(
      await screen.findByText("We couldn't count this list right now."),
    ).toBeInTheDocument()
    // Continue stays disabled when the count is unavailable.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(),
    )
  })

  it('enters the list builder from "Create a new list"', async () => {
    mockSavedLists()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()
  })

  // ENG-10948: the any-phone dialing hint is phone-banking-specific copy —
  // robocall dials landlines only and passes no filtersHint, so it must not
  // appear here.
  it('does not show the phone-banking any-phone-dialing hint', async () => {
    mockSavedLists()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()

    expect(
      screen.queryByText(/Phone banking calls whichever number/),
    ).not.toBeInTheDocument()
  })

  it('builds a list, creates it, and advances to the schedule step', async () => {
    mockSavedLists()
    mockBuilderCount(50)
    mockCreateList()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))

    // A selection makes the landline-overlaid builder count run; wait out the
    // debounce for the settled "Continue (50)".
    await userEvent.click(screen.getByText('mock-add-filter'))
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: /Continue \(50\)/ },
        { timeout: 3000 },
      ),
    )

    // Name step -> Create list -> POST /voter-file/filter -> schedule step.
    await userEvent.type(
      screen.getByLabelText('mock list name'),
      'My landline list',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }))
    expect(await screen.findByLabelText('Campaign name')).toBeInTheDocument()
  })

  it('surfaces an inline create error without advancing', async () => {
    mockSavedLists()
    mockBuilderCount(50)
    mockCreateListError()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    await userEvent.click(screen.getByText('mock-add-filter'))
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: /Continue \(50\)/ },
        { timeout: 3000 },
      ),
    )
    await userEvent.type(
      screen.getByLabelText('mock list name'),
      'My landline list',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }))

    expect(
      await screen.findByText(/We couldn't create this list/),
    ).toBeInTheDocument()
    // Did NOT advance — still on the name step.
    expect(screen.getByLabelText('mock list name')).toBeInTheDocument()
    expect(screen.queryByText('More coming soon')).not.toBeInTheDocument()

    // Back to filters must not carry the stale create error (which belongs to
    // the name step and whose retry button lives there).
    await userEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()
    expect(
      screen.queryByText(/We couldn't create this list/),
    ).not.toBeInTheDocument()

    // …and the cleared error must not re-flash when re-entering the name step.
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(50\)/ }),
    )
    expect(screen.getByLabelText('mock list name')).toBeInTheDocument()
    expect(
      screen.queryByText(/We couldn't create this list/),
    ).not.toBeInTheDocument()
  })

  it('clears the builder and returns to the picker on Back from filters', async () => {
    mockSavedLists()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Back'))
    // resetBuilder returns to the picker (mode -> picker); re-opening shows a
    // fresh builder with no carried-over selection.
    expect(await screen.findByText('Choose a voter list')).toBeInTheDocument()
    expect(screen.queryByText('Build a voter list')).not.toBeInTheDocument()
  })

  it('steps Back from the name step to filters, keeping the builder', async () => {
    mockSavedLists()
    mockBuilderCount(50)
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    await userEvent.click(screen.getByText('mock-add-filter'))
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: /Continue \(50\)/ },
        { timeout: 3000 },
      ),
    )
    // On the name step; Back returns to filters (not the picker), and the
    // built selection persists (count still shows).
    expect(screen.getByLabelText('mock list name')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /Continue \(50\)/ }),
    ).toBeInTheDocument()
  })

  it('discards the selected list when backing off the audience step', async () => {
    mockSavedLists()
    mockListDetail(80)
    await gotoAudience()

    // Pick a list so the selection is live (Continue enabled at 80).
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))
    await screen.findByRole('button', { name: /Continue \(80\)/ })

    // Back to purpose discards the pick; re-entering audience is a fresh picker
    // with Continue disabled, not a resumed selection.
    fireEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Introduce myself to voters')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Persuade likely voters'))

    expect(await screen.findByText('Choose a voter list')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(),
    )
  })

  it('resets to the purpose step when reopened after cancelling mid-flow', async () => {
    mockSavedLists()
    const onClose = vi.fn()
    const { rerender } = render(<RobocallFlow open onClose={onClose} />)

    // Advance off the purpose step so a resume would be observable.
    fireEvent.click(screen.getByText('Persuade likely voters'))
    expect(
      await screen.findByText(/We recommend reaching all your supporters/),
    ).toBeInTheDocument()

    // Close (cancel), then reopen — the open effect must reset the flow.
    rerender(<RobocallFlow open={false} onClose={onClose} />)
    rerender(<RobocallFlow open onClose={onClose} />)

    expect(screen.getByText('Introduce myself to voters')).toBeInTheDocument()
    expect(
      screen.queryByText(/We recommend reaching all your supporters/),
    ).not.toBeInTheDocument()
  })

  it('shows the schedule step with a pre-filled name and Continue disabled until valid', async () => {
    await gotoSchedule()

    // Intro copy + the three inputs; the name is auto-filled from the list.
    expect(
      screen.getByText(/We recommend mid-morning or early evening/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Campaign name')).toHaveValue(
      'Renters in 98103 robocall',
    )
    expect(screen.getByText('Pick a date')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: /Send time/ }),
    ).toBeInTheDocument()

    // No date/time chosen yet -> Continue disabled.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('refreshes the auto-filled name when a different list is chosen', async () => {
    await gotoSchedule()
    expect(screen.getByLabelText('Campaign name')).toHaveValue(
      'Renters in 98103 robocall',
    )

    // Back to the picker, choose a different saved list, continue again: the
    // untouched auto-name follows the new list rather than going stale.
    fireEvent.click(screen.getByLabelText('Back'))
    await userEvent.click(await screen.findByText('Renters in 98103'))
    await userEvent.click(await screen.findByText('All registered voters'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(80\)/ }),
    )

    expect(await screen.findByLabelText('Campaign name')).toHaveValue(
      'All registered voters robocall',
    )
  })

  it('advances to the compose step once a valid date and time are set', async () => {
    mockDraft()
    await gotoSchedule()

    // Open the date popover and pick a comfortably-future day (clears the 48h
    // floor), then a time.
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(await screen.findByText('mock-pick-future'))
    await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
    await userEvent.click(
      await screen.findByRole('option', { name: '10:00 AM' }),
    )

    const continueBtn = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(continueBtn).toBeEnabled())
    await userEvent.click(continueBtn)
    expect(
      await screen.findByText(/Read the script below into your microphone/),
    ).toBeInTheDocument()
  })

  it('warns and blocks when the chosen day+time is inside the 48-hour window', async () => {
    await gotoSchedule()

    // A past day is unambiguously inside the 48h floor; the combined-instant
    // check (not the calendar) is the gate.
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(await screen.findByText('mock-pick-past'))
    await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
    await userEvent.click(
      await screen.findByRole('option', { name: '10:00 AM' }),
    )

    expect(
      await screen.findByText(/Sends need at least 48 hours/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('drafts a script on entering compose and gates Continue on a saved recording', async () => {
    await gotoCompose()
    mockAudioUpload()

    // The AI draft (grounded self-ID opener) renders read-only for a
    // non-custom purpose.
    expect(
      await screen.findByText(/Hi, this is Alex, and I am running/),
    ).toBeInTheDocument()

    // No recording yet -> Continue disabled.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // Record -> the live timer shows elapsed over the 60s cap ("0:00 / 1:00").
    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    expect(screen.getByText('0:00 / 1:00')).toBeInTheDocument()

    // -> stop lands on preview (not yet committed): still disabled.
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    expect(
      await screen.findByText('Preview your recording'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // Save uploads to S3 then commits -> Continue enables and advances.
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Recording saved')).toBeInTheDocument()
    const continueBtn = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(continueBtn).toBeEnabled())
    await userEvent.click(continueBtn)
    expect(await screen.findByText('More coming soon')).toBeInTheDocument()
  })

  it('keeps the recording uncommitted when the S3 upload fails', async () => {
    await gotoCompose()
    mockAudioUpload(false)
    await screen.findByText(/Hi, this is Alex, and I am running/)

    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Upload failed: surface the error, stay in preview, keep Continue locked.
    expect(
      await screen.findByText(/We couldn't upload your recording/),
    ).toBeInTheDocument()
    expect(screen.getByText('Preview your recording')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('drops the saved recording when backing out of compose', async () => {
    await gotoCompose()
    mockAudioUpload()

    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Recording saved')

    // Back to schedule, then re-advance: the saved clip is gone, so Continue
    // is locked again until the user re-records (no stale-clip pass-through).
    await userEvent.click(screen.getByLabelText('Back'))
    await screen.findByLabelText('Campaign name')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText(/Read the script below into your microphone/)

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Start recording' }),
    ).toBeInTheDocument()
  })

  it('drops the saved recording when the tone changes', async () => {
    await gotoCompose()
    mockAudioUpload()

    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Recording saved')

    // Switching tone re-drafts the script the clip was read against, so the
    // recording is dropped and Continue locks until the candidate re-records.
    mockDraft('A punchier take for the urgent tone.')
    await userEvent.click(screen.getByText('Urgent'))

    expect(
      await screen.findByRole('button', { name: 'Start recording' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('re-drafts when a different tone is chosen', async () => {
    await gotoCompose()
    expect(
      await screen.findByText(/Hi, this is Alex, and I am running/),
    ).toBeInTheDocument()

    // A tone-pill click re-requests a draft; the new copy replaces the old.
    mockDraft('Friends, election day is almost here — make your plan to vote.')
    await userEvent.click(screen.getByText('Direct'))
    expect(
      await screen.findByText(/election day is almost here/),
    ).toBeInTheDocument()
  })

  it('re-drafts on Regenerate', async () => {
    await gotoCompose()
    expect(
      await screen.findByText(/Hi, this is Alex, and I am running/),
    ).toBeInTheDocument()

    mockDraft('A fresh take on why your vote matters this November.')
    await userEvent.click(screen.getByRole('button', { name: /Regenerate/ }))
    expect(
      await screen.findByText(/A fresh take on why your vote matters/),
    ).toBeInTheDocument()
  })

  it('shows the draft error card, and Try again re-drafts', async () => {
    mockDraftError()
    await gotoComposeRaw()

    // The on-entry draft failed -> error card.
    expect(
      await screen.findByText(/We couldn't draft your script just now/),
    ).toBeInTheDocument()

    // Try again with a working draft: the script renders and the card clears.
    mockDraft('A recovered draft for you.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByText(/A recovered draft for you/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/We couldn't draft your script just now/),
    ).not.toBeInTheDocument()
  })

  it('clears the draft error when switching to a custom purpose', async () => {
    mockDraftError()
    await gotoComposeRaw()
    expect(
      await screen.findByText(/We couldn't draft your script just now/),
    ).toBeInTheDocument()

    // Back to the purpose step: compose -> schedule -> audience -> purpose.
    await userEvent.click(screen.getByLabelText('Back'))
    await screen.findByLabelText('Campaign name')
    await userEvent.click(screen.getByLabelText('Back'))
    await userEvent.click(screen.getByLabelText('Back'))
    await screen.findByText('Write my own script')

    // Custom never drafts, so only the purpose-change reset can clear the
    // error. Switch to custom and return to compose (schedule kept its date).
    await userEvent.click(screen.getByText('Write my own script'))
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(80\)/ }),
    )
    await screen.findByLabelText('Campaign name')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Custom textarea shows and the stale error card is gone.
    expect(
      await screen.findByRole('textbox', { name: 'Robocall script' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/We couldn't draft your script just now/),
    ).not.toBeInTheDocument()
  })

  it('lets a custom purpose write its own script and never auto-drafts', async () => {
    await gotoCompose('Write my own script')
    // Arm a sentinel AFTER navigating (gotoCompose registers its own draft
    // mock); custom must never fire a draft, so this must never render.
    mockDraft('SHOULD-NOT-APPEAR auto draft')

    // No tone pills, no "Suggested for" line, and an editable textarea.
    expect(screen.queryByText('Direct')).not.toBeInTheDocument()
    expect(screen.queryByText(/Suggested for/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('SHOULD-NOT-APPEAR auto draft'),
    ).not.toBeInTheDocument()

    const textarea = screen.getByRole('textbox', { name: 'Robocall script' })
    await userEvent.type(textarea, 'Hi, this is my own script.')
    expect(textarea).toHaveValue('Hi, this is my own script.')
  })

  it('rents and shows the callback number on entering compose', async () => {
    await gotoCompose()
    // The rented number and the read-aloud reminder render above the script.
    expect(await screen.findByText('+12025550147')).toBeInTheDocument()
    expect(
      screen.getByText(/Read your callback number aloud/),
    ).toBeInTheDocument()
  })

  it('shows a retry when renting the callback number fails', async () => {
    mockRentNumberError()
    await gotoComposeRaw()

    // Renting failed: the error + retry render (no number yet).
    expect(
      await screen.findByText(/We couldn't get a callback number just now/),
    ).toBeInTheDocument()
    expect(screen.queryByText('+12025550147')).not.toBeInTheDocument()

    // Retry succeeds -> the number appears.
    mockRentNumber()
    mockDraft()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('+12025550147')).toBeInTheDocument()
  })

  it('threads the rented callback number into the draft request', async () => {
    let draftBody: RobocallScriptDraftRequest | null = null
    api.mock('POST /v1/outreach/robocall/draft', ({ body }) => {
      draftBody = body
      return { status: 200, data: { draft: 'A grounded script.' } }
    })

    await gotoComposeRaw()
    await screen.findByText(/A grounded script/)

    // The on-entry draft carries the rented number so the server can require
    // the spoken disclosure.
    expect(draftBody).toMatchObject({ callbackNumber: '+12025550147' })
  })

  it('does not draft the old purpose if it changes while renting', async () => {
    // Hold the rent open so a purpose change can land mid-flight.
    let releaseRent!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseRent = resolve
    })
    api.mock('POST /v1/outreach/robocall/number', async () => {
      await gate
      return {
        status: 200,
        data: { phoneNumber: '+12025550147', region: 'DC' },
      }
    })
    const draftPurposes: string[] = []
    api.mock('POST /v1/outreach/robocall/draft', ({ body }) => {
      draftPurposes.push(body.purpose)
      return { status: 200, data: { draft: 'a draft' } }
    })

    // Enter compose on "Persuade": the rent is in flight (body shows spinner).
    await gotoComposeRaw('Persuade likely voters')
    expect(
      await screen.findByText('Getting your callback number…'),
    ).toBeInTheDocument()

    // Back out to the purpose step and switch to "Introduce".
    await userEvent.click(screen.getByLabelText('Back')) // -> schedule
    await screen.findByLabelText('Campaign name')
    await userEvent.click(screen.getByLabelText('Back')) // -> audience
    await userEvent.click(screen.getByLabelText('Back')) // -> purpose
    await userEvent.click(screen.getByText('Introduce myself to voters'))

    // The gated rent resolves after the purpose changed; the guard must skip
    // the stale persuade draft.
    releaseRent()

    // Navigate forward into compose for Introduce and wait for ITS draft to
    // render. That synchronizes on the resolved rent, so the assertion runs
    // only after any (buggy) stale persuade draft would already have fired.
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(80\)/ }),
    )
    await screen.findByLabelText('Campaign name')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('a draft')

    // Only the current purpose was ever drafted — never the stale persuade one.
    expect(draftPurposes).toEqual(['introduce_myself'])
  })

  it('passes compliance on a saved recording and enables Continue', async () => {
    await gotoCompose()
    mockAudioUpload()

    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The compliance verdict renders and Continue unlocks.
    expect(
      await screen.findByText(/has everything it needs/),
    ).toBeInTheDocument()
    const continueBtn = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(continueBtn).toBeEnabled())
  })

  it('shows the issues and blocks Continue when compliance fails', async () => {
    await gotoCompose()
    mockAudioUpload()
    mockCompliance(false, [
      'The recording must name the organization behind the call.',
    ])

    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('Your recording is missing:'),
    ).toBeInTheDocument()
    expect(screen.getByText(/must name the organization/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('offers a retry when the compliance check errors', async () => {
    await gotoCompose()
    mockAudioUpload()
    mockComplianceError()

    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(/couldn't check your recording/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // Retry succeeds -> the verdict passes and Continue unlocks.
    mockCompliance(true)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
  })

  it('clears a passed verdict on re-record and re-checks the new clip', async () => {
    await gotoCompose()
    mockAudioUpload()

    const record = async () => {
      await userEvent.click(
        screen.getByRole('button', { name: 'Start recording' }),
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Stop recording' }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    }

    await record()
    expect(
      await screen.findByText(/has everything it needs/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )

    // Re-record drops the passed verdict — a stale pass must not keep Continue
    // enabled against a recording the candidate replaced.
    await userEvent.click(screen.getByRole('button', { name: 'Re-record' }))
    expect(
      screen.queryByText(/has everything it needs/),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // The fresh clip re-checks and re-enables.
    await record()
    expect(
      await screen.findByText(/has everything it needs/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
  })

  it('runs the compliance check exactly once per saved recording', async () => {
    let calls = 0
    api.mock('POST /v1/outreach/robocall/compliance', () => {
      calls += 1
      return {
        status: 200,
        data: {
          passed: true,
          checks: {
            hasSelfIdentification: true,
            hasOrganization: true,
            hasCallbackNumber: true,
          },
          transcript: 'Hi, this is Alex...',
          issues: [],
        },
      }
    })

    await gotoCompose()
    mockAudioUpload()
    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText(/has everything it needs/)
    // No spurious re-fire from the effect's dependency array.
    await waitFor(() => expect(calls).toBe(1))
    expect(calls).toBe(1)
  })
})
