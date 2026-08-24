import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { Website } from 'helpers/types'
import { EVENTS } from 'helpers/analyticsHelper'
import { MIN_BIO_LENGTH } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import ElectionFiling, { getInitialFormState } from './ElectionFiling'

type Campaign = Parameters<typeof getInitialFormState>[0]

// jsdom does not implement scrollTo; the invalid-profile submit path calls it.
window.scrollTo = vi.fn()

const mockTrackEvent = vi.fn()
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return {
    ...actual,
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  }
})

// [user, setUser, userLoading] — default to a loaded user so `ready` is true.
type UseUserReturn = [
  { email: string; phone: string } | null,
  () => void,
  boolean,
]
const readyUser: UseUserReturn = [
  { email: 'jane@example.com', phone: '5551234567' },
  vi.fn(),
  false,
]
const mockUseUser = vi.fn<() => UseUserReturn>(() => readyUser)
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ details: {} }],
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

vi.mock('app/shared/utils/RichEditor', async () => ({
  default: (await import('helpers/test-utils/RichEditorMock')).RichEditorMock,
}))

const { getUserWebsite, saveAboutFields } = vi.hoisted(() => ({
  getUserWebsite: vi.fn(),
  saveAboutFields: vi.fn(),
}))
vi.mock('app/dashboard/website/util/website.util', () => ({
  USER_WEBSITE_QUERY_KEY: ['user-website'],
  getUserWebsite,
  saveAboutFields,
}))

const { submitTcrCompliance } = vi.hoisted(() => ({
  submitTcrCompliance: vi.fn(),
}))
vi.mock(
  'app/dashboard/profile/texting-compliance/util/registrationFormData.util',
  () => ({
    submitTcrCompliance,
    toRegistrationFormData: (data: Record<string, unknown>) => data,
  }),
)

// Stub the heavy registration form — these tests verify ElectionFiling's
// orchestration (profile section gating + submit sequencing), not the form's
// internals. The stub mirrors the real form's composition contract: it
// renders `topSection`, lists `extraErrors` (label and message in separate
// nodes so tests can match the message text), and its submit trigger runs
// `onValidateExtra` before `onSubmit`, exactly like the real submit handler.
// Both the default export and the named `validateRegistrationForm` (used at
// module load) must be provided or the import of ElectionFiling throws.
vi.mock(
  'app/dashboard/profile/texting-compliance/register/components/TextingComplianceRegistrationForm',
  () => ({
    default: ({
      onSubmit,
      loading,
      topSection,
      onValidateExtra,
      extraErrors = [],
    }: {
      onSubmit: (formData: Record<string, unknown>) => void
      loading: boolean
      topSection?: React.ReactNode
      onValidateExtra?: () => boolean
      extraErrors?: { label: string; message: string }[]
    }) => (
      <div>
        <ul data-testid="extra-errors">
          {extraErrors.map(({ label, message }) => (
            <li key={label}>
              <span>{label}</span>
              <span>{message}</span>
            </li>
          ))}
        </ul>
        {topSection}
        <button
          data-testid="filing-submit"
          disabled={loading}
          onClick={() => {
            const extraValid = onValidateExtra ? onValidateExtra() : true
            if (!extraValid) return
            onSubmit({ email: 'filed@example.com' })
          }}
        >
          Submit filing
        </button>
      </div>
    ),
    validateRegistrationForm: () => ({}),
  }),
)

const websiteWith = (bio: string, issueCount: number): Website =>
  ({
    content: {
      about: {
        bio,
        issues: Array.from({ length: issueCount }, (_, i) => ({
          title: `Priority ${i + 1}`,
          description: 'y'.repeat(MIN_BIO_LENGTH),
        })),
      },
    },
  }) as unknown as Website

const PROFILE_HEADING = 'Tell voters about yourself'

const fillBio = async (): Promise<void> => {
  const editor = await screen.findByTestId('rich-editor')
  fireEvent.change(editor, { target: { value: 'a'.repeat(MIN_BIO_LENGTH) } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseUser.mockReturnValue(readyUser)
  getUserWebsite.mockResolvedValue(null)
})

describe('ElectionFiling — funnel view event (ENG-10294)', () => {
  it('fires Filing Details Viewed when the form is shown (ready)', async () => {
    render(<ElectionFiling />)
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.FilingDetailsViewed,
      )
    })
  })

  it('does not fire while only the loading state is shown (not ready)', async () => {
    // userLoading=true → `ready` is false → the form is hidden behind the
    // Loading… spinner, so the view event must not fire (matches EnterPin's
    // gated behavior — no over-counting users who never see the form).
    mockUseUser.mockReturnValue([null, vi.fn(), true])
    render(<ElectionFiling />)
    await waitFor(() => {
      expect(mockUseUser).toHaveBeenCalled()
    })
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingDetailsViewed,
    )
  })
})

describe('ElectionFiling — inline candidate profile collection (ENG-10857)', () => {
  it('renders the profile section when the website profile is incomplete', async () => {
    getUserWebsite.mockResolvedValue(websiteWith('', 0))
    render(<ElectionFiling />)

    expect(await screen.findByText(PROFILE_HEADING)).toBeInTheDocument()
    expect(await screen.findByTestId('rich-editor')).toBeInTheDocument()
  })

  it('still renders the form when the website read fails', async () => {
    // getUserWebsite throws on a failed read rather than degrading to null, so
    // `needsProfile` must settle on error too. Gating on isSuccess alone left
    // it null forever and stranded the page on its Loading… spinner.
    getUserWebsite.mockRejectedValue(new Error('Failed to load website: 500'))
    render(<ElectionFiling />)

    expect(await screen.findByTestId('filing-submit')).toBeInTheDocument()
    expect(await screen.findByText(PROFILE_HEADING)).toBeInTheDocument()
  })

  it('renders no profile section when the profile is already complete', async () => {
    getUserWebsite.mockResolvedValue(websiteWith('a'.repeat(MIN_BIO_LENGTH), 1))
    render(<ElectionFiling />)

    await screen.findByTestId('filing-submit')
    expect(screen.queryByText(PROFILE_HEADING)).not.toBeInTheDocument()
  })

  it('submits only the filing when the profile is complete', async () => {
    const user = userEvent.setup()
    getUserWebsite.mockResolvedValue(websiteWith('a'.repeat(MIN_BIO_LENGTH), 1))
    submitTcrCompliance.mockResolvedValue(undefined)
    render(<ElectionFiling />)

    await user.click(await screen.findByTestId('filing-submit'))

    await waitFor(() => expect(submitTcrCompliance).toHaveBeenCalledTimes(1))
    expect(saveAboutFields).not.toHaveBeenCalled()
  })

  it('blocks the filing submit and surfaces errors when the profile is invalid', async () => {
    const user = userEvent.setup()
    getUserWebsite.mockResolvedValue(websiteWith('', 0))
    render(<ElectionFiling />)

    // Wait for the editor to mount (profile seeded) before submitting.
    await screen.findByTestId('rich-editor')
    await user.click(screen.getByTestId('filing-submit'))

    expect(await screen.findByText('Please add your bio')).toBeInTheDocument()
    expect(
      screen.getByText('Please add at least one policy priority'),
    ).toBeInTheDocument()
    expect(saveAboutFields).not.toHaveBeenCalled()
    expect(submitTcrCompliance).not.toHaveBeenCalled()
  })

  it('persists the profile before submitting the filing', async () => {
    const user = userEvent.setup()
    // Incomplete only because the bio is missing — the saved issue is genuine,
    // so filling the bio is all the candidate needs to do.
    getUserWebsite.mockResolvedValue(websiteWith('', 1))
    const callLog: string[] = []
    saveAboutFields.mockImplementation(async () => {
      callLog.push('profile-save-called')
      await Promise.resolve()
      callLog.push('profile-save-resolved')
      return true
    })
    submitTcrCompliance.mockImplementation(async () => {
      callLog.push('filing-submit-called')
    })
    render(<ElectionFiling />)

    await fillBio()
    await user.click(screen.getByTestId('filing-submit'))

    await waitFor(() => expect(submitTcrCompliance).toHaveBeenCalledTimes(1))
    // Order is load-bearing: createAgentic dispatches the compliance agent
    // inline for already-Pro campaigns, so the profile PUT must have resolved
    // before the filing POST fires or the run still burns.
    expect(callLog).toEqual([
      'profile-save-called',
      'profile-save-resolved',
      'filing-submit-called',
    ])
    expect(saveAboutFields).toHaveBeenCalledWith(
      expect.objectContaining({
        bio: 'a'.repeat(MIN_BIO_LENGTH),
        issues: [expect.objectContaining({ title: 'Priority 1' })],
      }),
    )
  })

  it('does not submit the filing when the profile save fails', async () => {
    const user = userEvent.setup()
    getUserWebsite.mockResolvedValue(websiteWith('', 1))
    saveAboutFields.mockResolvedValue(false)
    render(<ElectionFiling />)

    await fillBio()
    await user.click(screen.getByTestId('filing-submit'))

    await waitFor(() => expect(saveAboutFields).toHaveBeenCalledTimes(1))
    expect(submitTcrCompliance).not.toHaveBeenCalled()
  })
})

describe('getInitialFormState — filing contact info not auto-filled (ENG-10290)', () => {
  const campaign = {
    details: { einNumber: '12-3456789', campaignCommittee: 'Friends of Jane' },
  } as Campaign

  it('leaves email and phone blank so the candidate must enter filing values', () => {
    const state = getInitialFormState(campaign)
    expect(state.email).toBe('')
    expect(state.phone).toBe('')
  })

  it('still pre-fills EIN and committee from the campaign filing details', () => {
    const state = getInitialFormState(campaign)
    expect(state.ein).toBe('12-3456789')
    expect(state.campaignCommitteeName).toBe('Friends of Jane')
  })

  it('defaults committee and EIN to empty when campaign details are missing', () => {
    const state = getInitialFormState({} as Campaign)
    expect(state.ein).toBe('')
    expect(state.campaignCommitteeName).toBe('')
    expect(state.email).toBe('')
    expect(state.phone).toBe('')
  })
})
