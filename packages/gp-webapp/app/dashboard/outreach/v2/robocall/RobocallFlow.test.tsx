import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  OutreachDetail,
  RobocallAuthorizeStatus,
  RobocallScriptDraftRequest,
} from '@goodparty_org/contracts'
import { http, HttpResponse } from 'msw'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { RobocallFlow } from './RobocallFlow'
import type { OutreachGateState } from '../gate/useOutreachGate'
import { gateRef } from '../gate/testing/mockReactiveGate'

// The gate's own flag/membership plumbing has its own tests; here the flow's
// wiring is what's under test, so the hook is driven directly through the
// shared reactive stand-in (see mockReactiveGate for why it is a module
// singleton rather than a hoisted ref).
vi.mock('../gate/useOutreachGate', async () => {
  const { useMockOutreachGate } =
    await import('../gate/testing/mockReactiveGate')
  return { useOutreachGate: useMockOutreachGate }
})

// Both mount real Stripe / filing surfaces; the flow only owns whether they
// are on screen.
vi.mock('app/dashboard/pro-upgrade/components/ProUpgradeFlow', () => ({
  // The completion is the candidate's Continue on the upgrade's success
  // screen — the one press the gate's own latch exists to keep reachable —
  // so the stand-in exposes it as a button. `onExit` is the wizard's own way
  // out, which is also what Back on its FIRST step calls.
  default: ({
    onComplete,
    onExit,
  }: {
    onComplete: () => void
    onExit: () => void
  }) => (
    <div data-testid="pro-upgrade-flow">
      <button type="button" onClick={onComplete}>
        Finish upgrade
      </button>
      <button type="button" onClick={onExit}>
        Finish later
      </button>
    </div>
  ),
}))
vi.mock(
  'app/dashboard/campaign-verification/components/CampaignVerificationSteps',
  () => ({ default: () => <div data-testid="campaign-verification" /> }),
)

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// PaymentPortalButton (the reused billing-portal affordance in the pay step)
// reads useSnackbar, which throws outside a SnackbarProvider — the minimal test
// render has none. A no-op stand-in keeps the real button so the portal-session
// call still fires and can be asserted.
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
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
        <button
          type="button"
          onClick={() => onSelect(new Date(Date.now() + 90 * 86_400_000))}
        >
          mock-pick-too-far
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

// The pay step mounts a Stripe SetupIntent Payment Element and confirms it.
// jsdom has no Stripe SDK, so stub the classic Elements library: Elements is a
// passthrough, PaymentElement a marker, and useStripe hands back a confirmSetup
// spy the tests drive. loadStripe is neutered so module load makes no network
// call. Mirrors the pro-upgrade PaymentStep test's Stripe stubbing.
const { confirmSetupMock } = vi.hoisted(() => ({ confirmSetupMock: vi.fn() }))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  // Surface the clientSecret it mounts against so a test can assert the pay
  // step remounts on a FRESH SetupIntent after a decline.
  Elements: ({
    children,
    options,
  }: {
    children: React.ReactNode
    options?: { clientSecret?: string }
  }) => (
    <div
      data-testid="stripe-elements"
      data-client-secret={options?.clientSecret}
    >
      {children}
    </div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmSetup: confirmSetupMock }),
  useElements: () => ({}),
}))

const mockCreateDraft = (
  amountInCents = 560,
  outreachId = 42,
  billableCount = 80,
  numberFeeInCents = 200,
) =>
  api.mock('POST /v1/outreach/robocall', {
    status: 200,
    data: { outreachId, billableCount, amountInCents, numberFeeInCents },
  })

const mockSaveCardIntent = () =>
  api.mock('POST /v1/outreach/robocall/save-card-intent', {
    status: 200,
    data: { clientSecret: 'seti_test_secret', customerId: 'cus_test_123' },
  })

const mockAuthorize = (
  status: RobocallAuthorizeStatus,
  authorizedAmountInCents: number | null,
  settleState: string,
) =>
  api.mock('POST /v1/outreach/robocall/:outreachId/authorize', {
    status: 200,
    data: { status, settleState, authorizedAmountInCents },
  })

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

const gotoAudience = async (
  purposeLabel = 'Persuade likely voters',
  onClose: () => void = vi.fn(),
) => {
  render(<RobocallFlow open onClose={onClose} />)
  fireEvent.click(screen.getByText(purposeLabel))
}

// Purpose -> audience -> pick a saved list -> Continue, landing on the schedule
// ("When") step.
const gotoSchedule = async (
  purposeLabel = 'Persuade likely voters',
  onClose: () => void = vi.fn(),
) => {
  mockSavedLists()
  mockListDetail(80)
  await gotoAudience(purposeLabel, onClose)
  await userEvent.click(await screen.findByText('Choose a voter list'))
  await userEvent.click(await screen.findByText('Renters in 98103'))
  await userEvent.click(
    await screen.findByRole('button', { name: /Continue \(80\)/ }),
  )
  await screen.findByLabelText('Campaign name')
}

// Schedule -> set a comfortably-future date + time -> Continue, landing on the
// compose ("What do you want to say?") step.
const gotoCompose = async (
  purposeLabel = 'Persuade likely voters',
  onClose: () => void = vi.fn(),
) => {
  mockDraft()
  await gotoSchedule(purposeLabel, onClose)
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

// Compose -> record + save (passes compliance via the beforeEach mock) ->
// Continue, landing on the review ("Review your campaign") step.
const gotoReview = async (
  purposeLabel = 'Persuade likely voters',
  onClose: () => void = vi.fn(),
) => {
  await gotoCompose(purposeLabel, onClose)
  mockAudioUpload()
  await userEvent.click(screen.getByRole('button', { name: 'Start recording' }))
  await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  const continueBtn = screen.getByRole('button', { name: 'Continue' })
  await waitFor(() => expect(continueBtn).toBeEnabled())
  await userEvent.click(continueBtn)
  await screen.findByRole('button', { name: 'Continue to payment' })
}

// Review -> Continue to payment, landing on the pay step. The pay step fires
// create-draft + save-card-intent on entry, so the caller registers those
// (and the authorize) mocks before calling.
const enterPay = async () =>
  userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))

describe('RobocallFlow', () => {
  // useElectedOffice fires on mount (no enable guard); 404 => not an elected
  // official (data null), exercising the hook's real 404->null branch.
  beforeEach(() => {
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'No elected office' },
    })
    // Answered so it never reaches the network. Left unhandled it passes
    // through, fails, and retries on a ~1s backoff, re-rendering the builder
    // partway through a test. Precinct itself is covered by PrecinctFilter
    // and usePrecinctOptions.
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    mockRentNumber()
    mockCompliance()
    // Reset call history + any queued once-implementations between tests, then
    // re-establish the default success.
    confirmSetupMock.mockReset()
    confirmSetupMock.mockResolvedValue({
      setupIntent: { payment_method: 'pm_test_123' },
    })
    gateRef.set({
      enabled: false,
      requirement: null,
      twoStep: false,
      membership: null,
      tcrCompliance: null,
    })
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
      screen.getByText(
        /Select a list or create a new one\. Lists include all voters with a landline\./,
      ),
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
      await screen.findByText(
        /Select a list or create a new one\. Lists include all voters with a landline\./,
      ),
    ).toBeInTheDocument()

    // Close (cancel), then reopen — the open effect must reset the flow.
    rerender(<RobocallFlow open={false} onClose={onClose} />)
    rerender(<RobocallFlow open onClose={onClose} />)

    expect(screen.getByText('Introduce myself to voters')).toBeInTheDocument()
    expect(
      screen.queryByText(
        /Select a list or create a new one\. Lists include all voters with a landline\./,
      ),
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

    // Open the date popover and pick a comfortably-future day, then a time.
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

  it('warns and blocks when the chosen day+time is in the past', async () => {
    await gotoSchedule()

    // The send only has to be in the future (no lead-time buffer), so a past
    // instant is the gate — enforced by the combined-instant check, not the
    // calendar.
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(await screen.findByText('mock-pick-past'))
    await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
    await userEvent.click(
      await screen.findByRole('option', { name: '10:00 AM' }),
    )

    expect(
      await screen.findByText(/Pick a send date and time in the future/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('warns and blocks when the chosen day is more than 85 days out', async () => {
    await gotoSchedule()

    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(await screen.findByText('mock-pick-too-far'))
    await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
    await userEvent.click(
      await screen.findByRole('option', { name: '10:00 AM' }),
    )

    expect(
      await screen.findByText(/Pick a send date within the next 85 days/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('allows a date within 85 days to advance', async () => {
    mockDraft()
    await gotoSchedule()

    // mock-pick-future is 60 days out — comfortably inside the 85-day cap.
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(await screen.findByText('mock-pick-future'))
    await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
    await userEvent.click(
      await screen.findByRole('option', { name: '10:00 AM' }),
    )

    expect(
      screen.queryByText(/Pick a send date within the next 85 days/),
    ).not.toBeInTheDocument()
    const continueBtn = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(continueBtn).toBeEnabled())
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
    // Advancing lands on the review step, not the placeholder.
    expect(
      await screen.findByRole('button', { name: 'Continue to payment' }),
    ).toBeInTheDocument()
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

  it('shows the callback number reminder in compose', async () => {
    await gotoCompose('Write my own script')
    // There is no banner now; a quiet reminder always surfaces the number so
    // the candidate can read it aloud, whichever purpose they picked.
    expect(
      await screen.findByText(/must say who paid for the call/),
    ).toBeInTheDocument()
    expect(screen.getByText(/\+12025550147/)).toBeInTheDocument()
  })

  it('shows a retry when renting the callback number fails', async () => {
    mockRentNumberError()
    await gotoComposeRaw()

    // Renting failed: the error + retry render (no number yet).
    expect(
      await screen.findByText(/We couldn't get a callback number just now/),
    ).toBeInTheDocument()
    expect(screen.queryByText('+12025550147')).not.toBeInTheDocument()

    // Retry succeeds -> the compose body unblocks and the drafted script
    // renders (the number itself now lives inside that script's disclosure).
    mockRentNumber()
    mockDraft()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByText(
        'Hi, this is Alex, and I am running for City Council.',
      ),
    ).toBeInTheDocument()
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

  it('shows the review summary after a saved recording', async () => {
    await gotoReview()

    // The pre-send summary reads back the audience, its reachable count, the
    // rented caller-ID number, and the estimated cost (80 * $0.045 = $3.60).
    expect(
      screen.getByRole('heading', { name: 'Review your campaign', level: 3 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Renters in 98103')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('Caller ID number')).toBeInTheDocument()
    expect(screen.getByText('+12025550147')).toBeInTheDocument()
    expect(screen.getByText('Estimated cost')).toBeInTheDocument()
    expect(screen.getByText('$3.60')).toBeInTheDocument()
    // The saved recording is playable and the read script is shown back.
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(
      screen.getByText('Hi, this is Alex, and I am running for City Council.'),
    ).toBeInTheDocument()
  })

  // Regression: a list BUILT in the flow is selected as the flow leaves the
  // audience step, so gating the reachability fetch on the audience step left
  // its count unresolved — the review step read a null (rendered 0) count while
  // the server independently found the real landline total. The reachable count
  // and its estimated cost must resolve for a built list, not fall back to 0.
  it('resolves the reachable count on review for a list built in the flow', async () => {
    mockSavedLists()
    mockBuilderCount(50)
    mockCreateList() // -> { id: 99, name: 'My landline list' }
    mockListDetail(12) // the created list's landline reachability
    mockDraft()

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

    // Schedule: set a comfortably-future date + time and advance.
    await screen.findByLabelText('Campaign name')
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(await screen.findByText('mock-pick-future'))
    await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
    await userEvent.click(
      await screen.findByRole('option', { name: '10:00 AM' }),
    )
    const toCompose = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(toCompose).toBeEnabled())
    await userEvent.click(toCompose)

    // Compose: record + save (passes compliance via the beforeEach mock).
    await screen.findByText(/Read the script below into your microphone/)
    mockAudioUpload()
    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Stop recording' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const toReview = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(toReview).toBeEnabled())
    await userEvent.click(toReview)

    // Review: the People row shows the resolved landline count (12), not 0, and
    // the estimated cost is 12 * $0.045 = $0.54, not $0.00.
    await screen.findByRole('button', { name: 'Continue to payment' })
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('$0.54')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('advances from review to the pay step and shows the server estimate', async () => {
    await gotoReview()
    mockCreateDraft(560)
    mockSaveCardIntent()
    await enterPay()

    // The estimate and Payment Element mount once both server calls resolve.
    // The amount shown is the server's ($5.60 total: $3.60 calls + $2 number),
    // never a client computation.
    expect(await screen.findByText('Amount to authorize')).toBeInTheDocument()
    expect(screen.getByTestId('payment-element')).toBeInTheDocument()
    // The breakdown is derived from server cents: the calls subtotal is the
    // total minus the fee, so a broken subtraction or a zero fee fails here (the
    // Authorize total alone would not catch it, since it reads amountInCents).
    expect(screen.getByText('Calls (80 reachable)')).toBeInTheDocument()
    expect(screen.getByText('$3.60')).toBeInTheDocument()
    expect(screen.getByText('Outgoing number')).toBeInTheDocument()
    expect(screen.getByText('$2.00')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Authorize \$5\.60/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('More coming soon')).not.toBeInTheDocument()
  })

  it('creates the draft, vaults the card, authorizes, and shows the authorized amount', async () => {
    let draftBody: {
      voterFileFilterId?: number
      audioKey?: string
      callbackNumber?: string
    } | null = null
    let draftScheduledAt: string | undefined
    let authorizeBody: { paymentMethodId?: string } | null = null

    api.mock('POST /v1/outreach/robocall', ({ body }) => {
      draftBody = body
      draftScheduledAt = body.scheduledAt
      return {
        status: 200,
        data: {
          outreachId: 42,
          billableCount: 80,
          amountInCents: 560,
          numberFeeInCents: 200,
        },
      }
    })
    mockSaveCardIntent()
    api.mock('POST /v1/outreach/robocall/:outreachId/authorize', ({ body }) => {
      authorizeBody = body
      return {
        status: 200,
        data: {
          status: 'authorized',
          settleState: 'authorized',
          authorizedAmountInCents: 560,
        },
      }
    })

    await gotoReview()
    await enterPay()

    const submit = await screen.findByRole('button', {
      name: /Authorize \$5\.60/,
    })
    await userEvent.click(submit)

    // The success screen renders with the SERVER's authorized amount.
    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(screen.getByText('$5.60')).toBeInTheDocument()
    expect(
      screen.getByText(
        /only charged for the calls we actually place, never more/,
      ),
    ).toBeInTheDocument()

    // create-draft carried the flow's list/audio/number and an offset-annotated
    // send time (never UTC Z); no client count/amount was ever sent.
    expect(draftBody).toMatchObject({
      voterFileFilterId: 1,
      audioKey: 'robocall/42/clip.webm',
      callbackNumber: '+12025550147',
    })
    expect(draftScheduledAt).toMatch(/T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)

    // The card was confirmed and its payment method placed the hold.
    expect(confirmSetupMock).toHaveBeenCalledWith({
      elements: {},
      redirect: 'if_required',
    })
    expect(authorizeBody).toEqual({ paymentMethodId: 'pm_test_123' })
  })

  it('renders a Done CTA on the success screen that closes the flow', async () => {
    const onClose = vi.fn()
    mockCreateDraft(560)
    mockSaveCardIntent()
    mockAuthorize('authorized', 560, 'authorized')

    await gotoReview('Persuade likely voters', onClose)
    await enterPay()
    await userEvent.click(
      await screen.findByRole('button', { name: /Authorize \$5\.60/ }),
    )
    await screen.findByText("You're all set")

    // The pay step owns no footer button once settled; the shell renders Done —
    // the only way out of the flow after paying.
    const done = screen.getByRole('button', { name: 'Done' })
    await userEvent.click(done)
    expect(onClose).toHaveBeenCalled()
  })

  it('bounces back to schedule if the send time elapses before payment', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    await gotoReview()

    // Freeze the clock past the chosen slot (mock-pick-future is 60 days out),
    // so goToPay sees the send time as elapsed at the review -> pay transition.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(Date.now() + 61 * 86_400_000))
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue to payment' }),
      )
      // Lands back on the schedule step with the past-time alert, not the pay
      // step, so createDraft never fires on a stale time.
      expect(
        screen.getByText(/Pick a send date and time in the future/),
      ).toBeInTheDocument()
      expect(screen.queryByText('Amount to authorize')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the deferred message when the hold is placed later', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    mockAuthorize('deferred', null, 'pending_payment')

    await gotoReview()
    await enterPay()
    await userEvent.click(
      await screen.findByRole('button', { name: /Authorize \$5\.60/ }),
    )

    // Deferred: the success screen shows the card is saved and the hold will be
    // placed closer to the send date, with no authorized amount (no hold yet).
    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(
      screen.getByText(/authorize the estimated cost a few days before/),
    ).toBeInTheDocument()
  })

  it('prompts for another card on a decline and remounts on a FRESH SetupIntent', async () => {
    mockCreateDraft(560)
    // Distinct client secrets per call, so the post-decline remount is
    // verifiably a new SetupIntent (a SetupIntent confirms once).
    let cardIntentCalls = 0
    api.mock('POST /v1/outreach/robocall/save-card-intent', () => {
      cardIntentCalls += 1
      return {
        status: 200,
        data: {
          clientSecret: `seti_secret_${cardIntentCalls}`,
          customerId: 'cus_test_123',
        },
      }
    })
    mockAuthorize('hold_failed', null, 'hold_failed')

    await gotoReview()
    await enterPay()

    // First mount used the first SetupIntent.
    expect(await screen.findByTestId('stripe-elements')).toHaveAttribute(
      'data-client-secret',
      'seti_secret_1',
    )
    await userEvent.click(
      screen.getByRole('button', { name: /Authorize \$5\.60/ }),
    )

    expect(
      await screen.findByText('Your card was declined'),
    ).toBeInTheDocument()

    // Try another card re-fetches a fresh SetupIntent and re-mounts against it.
    await userEvent.click(
      screen.getByRole('button', { name: 'Try another card' }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('stripe-elements')).toHaveAttribute(
        'data-client-secret',
        'seti_secret_2',
      ),
    )
    expect(
      screen.getByRole('button', { name: /Authorize \$5\.60/ }),
    ).toBeInTheDocument()
  })

  it('surfaces an inline error when the authorize request fails', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    api.mock('POST /v1/outreach/robocall/:outreachId/authorize', {
      status: 500,
      data: { message: 'boom' },
    })

    await gotoReview()
    await enterPay()
    const submit = await screen.findByRole('button', {
      name: /Authorize \$5\.60/,
    })
    await userEvent.click(submit)

    // A friendly inline message, not a raw error, and still on the form.
    expect(
      await screen.findByText(/couldn't authorize your card/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Authorize \$5\.60/ }),
    ).toBeInTheDocument()
  })

  it('does not double-submit: a second submit while one is in flight is a no-op', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    let authorizeCalls = 0
    api.mock('POST /v1/outreach/robocall/:outreachId/authorize', () => {
      authorizeCalls += 1
      return {
        status: 200,
        data: {
          status: 'authorized',
          settleState: 'authorized',
          authorizedAmountInCents: 560,
        },
      }
    })

    // Hold confirmSetup open so a second submit lands while the first is still
    // confirming.
    let releaseConfirm!: () => void
    confirmSetupMock.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseConfirm = () =>
          resolve({ setupIntent: { payment_method: 'pm_test_123' } })
      }),
    )

    await gotoReview()
    await enterPay()
    const submit = await screen.findByRole('button', {
      name: /Authorize \$5\.60/,
    })
    await userEvent.click(submit)

    // The button is disabled while in flight, and firing the form submit again
    // (the internal guard) does not start a second confirm.
    expect(submit).toBeDisabled()
    fireEvent.submit(submit.closest('form') as HTMLFormElement)
    expect(confirmSetupMock).toHaveBeenCalledTimes(1)

    releaseConfirm()
    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(confirmSetupMock).toHaveBeenCalledTimes(1)
    expect(authorizeCalls).toBe(1)
  })

  it('retries after an authorize throw WITHOUT re-confirming the card', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    let authorizeCalls = 0
    let lastAuthorizeBody: { paymentMethodId?: string } | null = null
    api.mock('POST /v1/outreach/robocall/:outreachId/authorize', ({ body }) => {
      authorizeCalls += 1
      lastAuthorizeBody = body
      if (authorizeCalls === 1)
        return { status: 500, data: { message: 'boom' } }
      return {
        status: 200,
        data: {
          status: 'authorized',
          settleState: 'authorized',
          authorizedAmountInCents: 560,
        },
      }
    })

    await gotoReview()
    await enterPay()
    const submit = await screen.findByRole('button', {
      name: /Authorize \$5\.60/,
    })

    // First attempt: confirmSetup succeeds (card vaulted), then authorize throws.
    await userEvent.click(submit)
    expect(
      await screen.findByText(/couldn't authorize your card/),
    ).toBeInTheDocument()
    expect(confirmSetupMock).toHaveBeenCalledTimes(1)

    // Retry: must NOT re-confirm the already-vaulted card (a SetupIntent
    // confirms once), and must re-authorize with that same payment method.
    await userEvent.click(
      screen.getByRole('button', { name: /Authorize \$5\.60/ }),
    )
    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(confirmSetupMock).toHaveBeenCalledTimes(1)
    expect(authorizeCalls).toBe(2)
    expect(lastAuthorizeBody).toEqual({ paymentMethodId: 'pm_test_123' })
  })

  it('shows the Stripe error and skips authorize when confirmSetup fails', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    let authorizeCalls = 0
    api.mock('POST /v1/outreach/robocall/:outreachId/authorize', () => {
      authorizeCalls += 1
      return {
        status: 200,
        data: {
          status: 'authorized',
          settleState: 'authorized',
          authorizedAmountInCents: 560,
        },
      }
    })
    confirmSetupMock.mockResolvedValueOnce({
      error: { message: 'Your card number is incomplete.' },
    })

    await gotoReview()
    await enterPay()
    await userEvent.click(
      await screen.findByRole('button', { name: /Authorize \$5\.60/ }),
    )

    expect(
      await screen.findByText('Your card number is incomplete.'),
    ).toBeInTheDocument()
    expect(authorizeCalls).toBe(0)
  })

  it('shows an error and skips authorize when no payment method comes back', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    let authorizeCalls = 0
    api.mock('POST /v1/outreach/robocall/:outreachId/authorize', () => {
      authorizeCalls += 1
      return {
        status: 200,
        data: {
          status: 'authorized',
          settleState: 'authorized',
          authorizedAmountInCents: 560,
        },
      }
    })
    confirmSetupMock.mockResolvedValueOnce({
      setupIntent: { payment_method: null },
    })

    await gotoReview()
    await enterPay()
    await userEvent.click(
      await screen.findByRole('button', { name: /Authorize \$5\.60/ }),
    )

    expect(
      await screen.findByText(/couldn't read your saved card/),
    ).toBeInTheDocument()
    expect(authorizeCalls).toBe(0)
  })

  it('renders the create-draft error with a working retry', async () => {
    let createCalls = 0
    api.mock('POST /v1/outreach/robocall', () => {
      createCalls += 1
      return createCalls === 1
        ? { status: 500, data: { message: 'boom' } }
        : {
            status: 200,
            data: {
              outreachId: 42,
              billableCount: 80,
              amountInCents: 560,
              numberFeeInCents: 200,
            },
          }
    })
    mockSaveCardIntent()

    await gotoReview()
    await enterPay()

    // The create-draft failure surfaces inline (not a raw error) with a retry.
    expect(
      await screen.findByText(/couldn't set up your payment just now/),
    ).toBeInTheDocument()

    // Try again re-creates the draft and the estimate + form appear.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Amount to authorize')).toBeInTheDocument()
  })

  it('shows the result on re-entry after authorizing, without re-running the money calls', async () => {
    let createCalls = 0
    let cardIntentCalls = 0
    api.mock('POST /v1/outreach/robocall', () => {
      createCalls += 1
      return {
        status: 200,
        data: {
          outreachId: 42,
          billableCount: 80,
          amountInCents: 560,
          numberFeeInCents: 200,
        },
      }
    })
    api.mock('POST /v1/outreach/robocall/save-card-intent', () => {
      cardIntentCalls += 1
      return {
        status: 200,
        data: { clientSecret: 'seti_test_secret', customerId: 'cus_test_123' },
      }
    })
    mockAuthorize('authorized', 560, 'authorized')

    await gotoReview()
    await enterPay()
    await userEvent.click(
      await screen.findByRole('button', { name: /Authorize \$5\.60/ }),
    )
    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(createCalls).toBe(1)
    expect(cardIntentCalls).toBe(1)

    // Back to review, then re-enter pay: the authorized result shows again —
    // no Authorize form, and no second create-draft / save-card-intent.
    await userEvent.click(screen.getByLabelText('Back'))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue to payment' }),
    )

    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Authorize/ }),
    ).not.toBeInTheDocument()
    expect(createCalls).toBe(1)
    expect(cardIntentCalls).toBe(1)
  })

  it('does not tell the user to refresh on a noop outcome', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    mockAuthorize('noop', null, 'pending_payment')

    await gotoReview()
    await enterPay()
    await userEvent.click(
      await screen.findByRole('button', { name: /Authorize \$5\.60/ }),
    )

    expect(await screen.findByText(/already set up/)).toBeInTheDocument()
    expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument()
  })

  it('returns to compose from review, keeping the saved recording', async () => {
    await gotoReview()
    await userEvent.click(screen.getByLabelText('Back'))

    // Back lands on compose with the saved clip intact (no re-record needed).
    expect(
      await screen.findByText(/Read the script below into your microphone/),
    ).toBeInTheDocument()
    expect(screen.getByText('Recording saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('opens the Stripe billing portal from the pay form to manage cards', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()

    // The reused portal-session call (POST /payments/purchase/portal-session)
    // is a legacy route, not a typed APIEndpoints key, so it's mocked as a raw
    // MSW handler rather than through api.mock.
    let portalCalls = 0
    mswServer.use(
      http.post('*/payments/purchase/portal-session', () => {
        portalCalls += 1
        return HttpResponse.json({
          redirectUrl: 'https://billing.stripe.test/session/1',
        })
      }),
    )

    // PaymentPortalButton redirects via window.location.href; capture it so
    // jsdom doesn't attempt an unimplemented navigation.
    const hrefSetter = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return 'http://localhost/'
        },
        set href(value: string) {
          hrefSetter(value)
        },
      },
    })

    try {
      await gotoReview()
      await enterPay()

      const manage = await screen.findByRole('button', {
        name: /Manage payment methods/,
      })
      await userEvent.click(manage)

      await waitFor(() => expect(portalCalls).toBe(1))
      await waitFor(() =>
        expect(hrefSetter).toHaveBeenCalledWith(
          'https://billing.stripe.test/session/1',
        ),
      )
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('surfaces the billing portal link on the decline retry card', async () => {
    mockCreateDraft(560)
    mockSaveCardIntent()
    mockAuthorize('hold_failed', null, 'hold_failed')

    await gotoReview()
    await enterPay()
    await userEvent.click(
      await screen.findByRole('button', { name: /Authorize \$5\.60/ }),
    )
    await screen.findByText('Your card was declined')

    // A declined candidate can both retry with a new card and reach the portal
    // to remove the failed one.
    expect(
      screen.getByRole('button', { name: 'Try another card' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Manage payment methods/ }),
    ).toBeInTheDocument()
  })

  describe('pro gate and drafts', () => {
    const GATE_LINE = 'Pro is needed before this call can go out.'

    // The free build path's only audience. Both Pro-gated voter-file reads
    // (the builder's count and a saved list's landline reach count) 403 for
    // this candidate, so the recommendation card — which carries its own
    // count — is what the step offers and what the summary prices off.
    const RECOMMENDATION = {
      variant: 'persuadeAffinity' as const,
      intent: 'persuade' as const,
      filter: { independentAffinity: true },
      count: 900,
      copy: {
        title: 'Persuadable independents',
        criteriaSummary: 'Moderate to high propensity voters',
      },
      existingFilterId: 1,
    }

    // The same card before it has ever been saved: the candidate names it,
    // the flow creates the list, and the count has to survive that.
    const NEW_RECOMMENDATION = {
      ...RECOMMENDATION,
      variant: 'persuadeUndecided' as const,
      copy: {
        title: 'Undecided persuadables',
        criteriaSummary: 'Undecided voters',
      },
      existingFilterId: null,
    }

    // Truthful for a free campaign: gp-api refuses list-detail without Pro.
    const mockFreeAudience = () => {
      let listDetailCalls = 0
      api.mock('GET /v1/contacts/list-detail', () => {
        listDetailCalls += 1
        return { status: 403, data: { message: 'Pro subscription required' } }
      })
      api.mock('GET /v1/campaigns/mine/recommended-lists', {
        status: 200,
        data: [RECOMMENDATION],
      })
      return () => listDetailCalls
    }

    const FREE_GATE: OutreachGateState = {
      enabled: true,
      requirement: 'pro',
      twoStep: false,
      membership: {
        tier: 'free',
        texting: 'needs_verification',
        pinDelivery: null,
        isElectedOffice: false,
      },
      tcrCompliance: null,
    }

    const PRO_GATE: OutreachGateState = {
      enabled: true,
      requirement: null,
      twoStep: false,
      membership: {
        tier: 'pro',
        texting: 'cleared',
        pinDelivery: null,
        isElectedOffice: false,
      },
      tcrCompliance: null,
    }

    const DRAFT_SCRIPT =
      'Hi, this is Alex, and I am running for City Council. Paid for by ' +
      'Friends of Alex. Call me back at 202-555-0147.'

    const draftDetail = (
      overrides: Partial<OutreachDetail> = {},
    ): OutreachDetail => ({
      id: 88,
      createdAt: new Date('2026-08-20T12:00:00Z'),
      updatedAt: new Date('2026-08-20T12:00:00Z'),
      campaignId: 9,
      outreachType: 'robocall',
      projectId: null,
      name: 'Renters in 98103 robocall',
      status: 'draft',
      error: null,
      audienceRequest: null,
      script: DRAFT_SCRIPT,
      message: null,
      date: null,
      imageUrl: null,
      voterFileFilterId: 1,
      doorKnockingRouteId: null,
      phoneListId: null,
      identityId: null,
      didState: null,
      didNpaSubset: [],
      title: null,
      textCount: null,
      billableTextCount: null,
      campaignPlanDueDate: null,
      organizationSlug: 'campaign-9',
      archivedAt: null,
      robocall: {
        audioKey: 'robocall/42/clip.webm',
        callbackNumber: '+12025550147',
      },
      ...overrides,
    })

    const mockSaveDraft = () => {
      const bodies: unknown[] = []
      api.mock('POST /v1/outreach/drafts', ({ body }) => {
        bodies.push(body)
        return { status: 200, data: draftDetail({ id: 77 }) }
      })
      return bodies
    }

    // Build mode drops the schedule step: purpose -> audience -> compose ->
    // review, ending on the summary the draft save reads from.
    const buildToReview = async (onClose: () => void = vi.fn()) => {
      mockDraft()
      mockSavedLists()
      const listDetailCalls = mockFreeAudience()
      render(<RobocallFlow open onClose={onClose} />)
      fireEvent.click(screen.getByText('Persuade likely voters'))
      // Recommendations only: the picker offers no saved lists here.
      expect(screen.queryByText('Choose a voter list')).not.toBeInTheDocument()
      await userEvent.click(await screen.findByText('Persuadable independents'))
      await userEvent.click(
        await screen.findByRole('button', { name: /Continue \(900\)/ }),
      )
      await screen.findByText(/Read the script below into your microphone/)
      mockAudioUpload()
      await userEvent.click(
        screen.getByRole('button', { name: 'Start recording' }),
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Stop recording' }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const continueBtn = screen.getByRole('button', { name: 'Continue' })
      await waitFor(() => expect(continueBtn).toBeEnabled())
      await userEvent.click(continueBtn)
      await screen.findByRole('button', { name: 'Save draft' })
      return listDetailCalls
    }

    const saveDraft = () =>
      userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    // The banner rides every build-mode step, so its explainer can open the
    // gate long before there is a draft. Finishing there must hand the
    // candidate back the step they were on — landing them on schedule would
    // throw away the audience and the recording they just made.
    it('keeps the build intact when the upgrade starts from the banner', async () => {
      gateRef.set(FREE_GATE)
      const bodies = mockSaveDraft()
      mockDraft()
      mockSavedLists()
      mockFreeAudience()
      render(<RobocallFlow open onClose={vi.fn()} />)

      fireEvent.click(screen.getByText('Persuade likely voters'))
      await userEvent.click(await screen.findByText('Persuadable independents'))

      await userEvent.click(screen.getByText(GATE_LINE))
      await userEvent.click(
        await screen.findByRole('button', { name: 'Join Pro' }),
      )
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()

      act(() => gateRef.set(PRO_GATE))
      await userEvent.click(
        screen.getByRole('button', { name: 'Finish upgrade' }),
      )

      // Back on the audience step with the audience still picked, not dropped
      // on schedule against a draft that was never written.
      expect(
        await screen.findByText('Persuadable independents'),
      ).toBeInTheDocument()
      expect(bodies).toEqual([])
    })

    // The whole free build path, with every Pro-gated read answering the way
    // gp-api really answers it: the reach count is the recommendation's own,
    // and nothing asks list-detail for one.
    it('reaches review and prices the summary off the recommendation', async () => {
      gateRef.set(FREE_GATE)
      mockSaveDraft()
      // buildToReview registers the audience mocks itself and hands back the
      // live counter. Registering a second set here would leave this test
      // counting a handler msw had already replaced.
      const listDetailCalls = await buildToReview()

      expect(screen.getByText('People')).toBeInTheDocument()
      expect(screen.getByText('900')).toBeInTheDocument()
      expect(screen.getByText('Estimated cost')).toBeInTheDocument()
      expect(listDetailCalls()).toBe(0)
    })

    // The FIRST time a recommendation is taken there is no saved list yet, so
    // it goes through createRecommendedList rather than the reuse branch.
    // That path has to carry the card's count too, or the very first free
    // build reaches review with no People row and no estimate.
    it('carries the count through a recommendation saved for the first time', async () => {
      gateRef.set(FREE_GATE)
      mockSaveDraft()
      mockDraft()
      mockSavedLists()
      const listDetailCalls = mockFreeAudience()
      api.mock('GET /v1/campaigns/mine/recommended-lists', {
        status: 200,
        data: [NEW_RECOMMENDATION],
      })
      api.mock('POST /v1/voters/voter-file/filter', {
        status: 200,
        data: { id: 71, name: 'Undecided persuadables' },
      })
      render(<RobocallFlow open onClose={vi.fn()} />)

      fireEvent.click(screen.getByText('Persuade likely voters'))
      // A card with no saved list behind it opens the naming drawer, and its
      // Continue is what creates the list.
      await userEvent.click(await screen.findByText('Undecided persuadables'))
      expect(await screen.findByLabelText('List name')).toHaveValue(
        'Undecided persuadables',
      )
      await userEvent.click(
        await screen.findByRole('button', { name: 'Continue' }),
      )
      await screen.findByText(/Read the script below into your microphone/)
      mockAudioUpload()
      await userEvent.click(
        screen.getByRole('button', { name: 'Start recording' }),
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Stop recording' }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const continueBtn = screen.getByRole('button', { name: 'Continue' })
      await waitFor(() => expect(continueBtn).toBeEnabled())
      await userEvent.click(continueBtn)
      await screen.findByRole('button', { name: 'Save draft' })

      expect(screen.getByText('People')).toBeInTheDocument()
      expect(screen.getByText('900')).toBeInTheDocument()
      expect(screen.getByText('Estimated cost')).toBeInTheDocument()
      expect(listDetailCalls()).toBe(0)
    })

    // The banner's gate opens the wizard on its first step, whose Back is the
    // wizard's own exit. Wired straight to onClose it shut the sheet on a
    // candidate who had only wanted to read what Pro was.
    it('keeps the build when Back is pressed on the banner-opened gate', async () => {
      gateRef.set(FREE_GATE)
      mockSaveDraft()
      mockDraft()
      mockSavedLists()
      mockFreeAudience()
      const onClose = vi.fn()
      render(<RobocallFlow open onClose={onClose} />)

      fireEvent.click(screen.getByText('Persuade likely voters'))
      await userEvent.click(await screen.findByText('Persuadable independents'))

      await userEvent.click(screen.getByText(GATE_LINE))
      await userEvent.click(
        await screen.findByRole('button', { name: 'Join Pro' }),
      )
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()

      await userEvent.click(
        screen.getByRole('button', { name: 'Finish later' }),
      )

      expect(
        await screen.findByText('Persuadable independents'),
      ).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('saves the robocall as a draft and opens the Pro interstitial', async () => {
      gateRef.set(FREE_GATE)
      const bodies = mockSaveDraft()

      await buildToReview()
      expect(screen.getByText(GATE_LINE)).toBeInTheDocument()
      await saveDraft()

      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
      expect(bodies).toEqual([
        expect.objectContaining({
          outreachType: 'robocall',
          name: 'Renters in 98103 robocall',
          voterFileFilterId: 1,
          audioKey: 'robocall/42/clip.webm',
          callbackNumber: '+12025550147',
        }),
      ])
    })

    it('switches into resume mode when a draft already exists', async () => {
      gateRef.set(FREE_GATE)
      api.mock('POST /v1/outreach/drafts', {
        status: 409,
        data: { message: 'already', existingId: 55 },
      })
      const detailRequests: string[] = []
      api.mock('GET /v1/outreach/:id', ({ params }) => {
        detailRequests.push(params.id)
        return { status: 200, data: draftDetail({ id: 55 }) }
      })
      const deleted: string[] = []
      api.mock('DELETE /v1/outreach/:id', ({ params }) => {
        deleted.push(params.id)
        return { status: 200, data: undefined }
      })

      await buildToReview()
      await saveDraft()

      await waitFor(() => expect(detailRequests).toEqual(['55']))
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
      // The flow is now working the existing row, not the one it tried to
      // write: the gate's Delete targets 55.
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(deleted).toEqual(['55']))
    })

    // The requirement clears while the upgrade's own success screen is
    // still up. The gate must stay put until the candidate presses Continue
    // there, and then land them on the schedule step: a resumed row has no
    // send date, and review is one enabled button from the pay step.
    it('lands the 409 resume on the schedule step once the upgrade completes', async () => {
      gateRef.set(FREE_GATE)
      api.mock('POST /v1/outreach/drafts', {
        status: 409,
        data: { message: 'already', existingId: 55 },
      })
      api.mock('GET /v1/outreach/:id', {
        status: 200,
        data: draftDetail({ id: 55 }),
      })

      await buildToReview()
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')

      act(() => gateRef.set(PRO_GATE))

      // Still on the upgrade's success screen, not dumped back into the flow.
      expect(screen.getByTestId('pro-upgrade-flow')).toBeInTheDocument()

      await userEvent.click(
        screen.getByRole('button', { name: 'Finish upgrade' }),
      )

      expect(await screen.findByLabelText('Campaign name')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Continue to payment' }),
      ).not.toBeInTheDocument()
    })

    it('reports a failed draft save on the review step', async () => {
      gateRef.set(FREE_GATE)
      api.mock('POST /v1/outreach/drafts', {
        status: 500,
        data: { message: 'boom' },
      })

      await buildToReview()
      await saveDraft()

      expect(
        await screen.findByText("We couldn't save this draft. Try again."),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('pro-upgrade-flow')).not.toBeInTheDocument()
    })

    it('blocks the resume when the draft list is gone', async () => {
      gateRef.set(PRO_GATE)
      api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })

      render(
        <RobocallFlow open onClose={vi.fn()} resumeDraft={draftDetail()} />,
      )

      expect(
        await screen.findByText(
          'The voter list for this call is no longer available.',
        ),
      ).toBeInTheDocument()
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(await screen.findByText('mock-pick-future'))
      await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
      await userEvent.click(
        await screen.findByRole('option', { name: '10:00 AM' }),
      )
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('opens a cleared draft at the schedule step and converts it', async () => {
      gateRef.set(PRO_GATE)
      mockSavedLists()
      mockListDetail(80)
      mockSaveCardIntent()
      const bodies: unknown[] = []
      api.mock('POST /v1/outreach/robocall', ({ body }) => {
        bodies.push(body)
        return {
          status: 200,
          data: {
            outreachId: 88,
            billableCount: 80,
            amountInCents: 560,
            numberFeeInCents: 200,
          },
        }
      })

      render(
        <RobocallFlow open onClose={vi.fn()} resumeDraft={draftDetail()} />,
      )

      await screen.findByLabelText('Campaign name')
      expect(screen.queryByText(GATE_LINE)).not.toBeInTheDocument()
      // Purpose, audience and compose were settled when the draft was saved,
      // so there is nowhere to go back to.
      expect(
        screen.queryByRole('button', { name: 'Back' }),
      ).not.toBeInTheDocument()
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(await screen.findByText('mock-pick-future'))
      await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))
      await userEvent.click(
        await screen.findByRole('option', { name: '10:00 AM' }),
      )
      const continueBtn = screen.getByRole('button', { name: 'Continue' })
      await waitFor(() => expect(continueBtn).toBeEnabled())
      await userEvent.click(continueBtn)

      await userEvent.click(
        await screen.findByRole('button', { name: 'Continue to payment' }),
      )

      await waitFor(() =>
        expect(bodies).toEqual([
          expect.objectContaining({
            draftOutreachId: 88,
            audioKey: 'robocall/42/clip.webm',
            callbackNumber: '+12025550147',
            voterFileFilterId: 1,
            script: DRAFT_SCRIPT,
          }),
        ]),
      )
    })

    it('deletes the draft from the gate and closes the flow', async () => {
      gateRef.set(FREE_GATE)
      mockSaveDraft()
      const deleted: string[] = []
      api.mock('DELETE /v1/outreach/:id', ({ params }) => {
        deleted.push(params.id)
        return { status: 200, data: undefined }
      })
      const onClose = vi.fn()

      await buildToReview(onClose)
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(deleted).toEqual(['77']))
      expect(onClose).toHaveBeenCalled()
    })

    it('reports the saved draft and the deleted one', async () => {
      gateRef.set(FREE_GATE)
      mockSaveDraft()
      api.mock('DELETE /v1/outreach/:id', { status: 200, data: undefined })

      await buildToReview()
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')

      expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
        EVENTS.Outreach.Draft.Saved,
        { channel: 'robocall' },
      )

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() =>
        expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
          EVENTS.Outreach.Draft.Deleted,
          { channel: 'robocall' },
        ),
      )
    })

    // A 409 wrote nothing — the campaign already had the row — so it is not
    // a save.
    it('reports no save when the draft already existed', async () => {
      vi.mocked(trackEvent).mockClear()
      gateRef.set(FREE_GATE)
      api.mock('POST /v1/outreach/drafts', {
        status: 409,
        data: { message: 'already', existingId: 55 },
      })
      api.mock('GET /v1/outreach/:id', {
        status: 200,
        data: draftDetail({ id: 55 }),
      })

      await buildToReview()
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')

      expect(vi.mocked(trackEvent)).not.toHaveBeenCalledWith(
        EVENTS.Outreach.Draft.Saved,
        expect.anything(),
      )
    })

    it('renders no banner and keeps the schedule step with the flag off', async () => {
      mockDraft()
      mockSavedLists()
      mockListDetail(80)
      render(<RobocallFlow open onClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Persuade likely voters'))
      await userEvent.click(await screen.findByText('Choose a voter list'))
      await userEvent.click(await screen.findByText('Renters in 98103'))
      await userEvent.click(
        await screen.findByRole('button', { name: /Continue \(80\)/ }),
      )

      expect(await screen.findByLabelText('Campaign name')).toBeInTheDocument()
      expect(screen.queryByText(GATE_LINE)).not.toBeInTheDocument()
    })
  })
})
