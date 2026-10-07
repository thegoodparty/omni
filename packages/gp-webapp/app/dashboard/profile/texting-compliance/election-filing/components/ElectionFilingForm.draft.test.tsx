import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { Website } from 'helpers/types'
import { useFormData } from '@shared/hooks/useFormData'
import { MIN_BIO_LENGTH } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import {
  readVerificationDraft,
  saveVerificationDraft,
} from 'app/dashboard/campaign-verification/verificationDraft'
import ElectionFilingForm from './ElectionFilingForm'

window.scrollTo = vi.fn()

const CAMPAIGN_ID = 7
const VALID_EIN = '27-4815162'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ email: 'sarah@example.com' }, vi.fn(), false],
}))

const mockCampaign = vi.fn<() => { id: number; details: object } | null>(
  () => ({ id: CAMPAIGN_ID, details: {} }),
)
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign()],
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

// Stubbed down to what the draft touches: two fields bound to the form
// state, the composed profile section, and a submit that hands over the
// current form data like the real form does.
vi.mock(
  'app/dashboard/profile/texting-compliance/register/components/TextingComplianceRegistrationForm',
  () => ({
    default: function MockRegistrationForm({
      onSubmit,
      topSection,
    }: {
      onSubmit: (formData: Record<string, unknown>) => void
      topSection?: React.ReactNode
    }) {
      const { formData, handleChange } = useFormData()
      return (
        <div>
          {topSection}
          <input
            aria-label="Candidate name"
            value={String(formData.candidateName ?? '')}
            onChange={(e) => handleChange({ candidateName: e.target.value })}
          />
          <input
            aria-label="EIN"
            value={String(formData.ein ?? '')}
            onChange={(e) => handleChange({ ein: e.target.value })}
          />
          <button onClick={() => onSubmit(formData)}>Submit filing</button>
        </div>
      )
    },
    validateRegistrationForm: () => ({}),
  }),
)

const incompleteWebsite = {
  content: { about: { bio: '', issues: [] } },
} as unknown as Website

const DRAFT_BIO = 'b'.repeat(MIN_BIO_LENGTH)
const DRAFT_ISSUES = [{ title: 'Parks', description: 'p'.repeat(40) }]

const completeWebsite = {
  content: {
    about: {
      bio: DRAFT_BIO,
      issues: [{ title: 'Roads', description: 'r'.repeat(MIN_BIO_LENGTH) }],
    },
  },
} as unknown as Website

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mockCampaign.mockReturnValue({ id: CAMPAIGN_ID, details: {} })
  getUserWebsite.mockResolvedValue(incompleteWebsite)
  saveAboutFields.mockResolvedValue(true)
  submitTcrCompliance.mockResolvedValue(undefined)
})

describe('ElectionFilingForm — verification draft', () => {
  it('restores drafted filing fields and profile on return', async () => {
    saveVerificationDraft(CAMPAIGN_ID, {
      filing: { candidateName: 'Sarah Chen' },
      profile: { bio: DRAFT_BIO, issues: DRAFT_ISSUES },
    })
    render(<ElectionFilingForm onSubmitted={vi.fn()} persistDraft />)

    expect(await screen.findByLabelText('Candidate name')).toHaveValue(
      'Sarah Chen',
    )
    expect(await screen.findByTestId('rich-editor')).toHaveValue(DRAFT_BIO)
    expect(screen.getByText('Parks')).toBeInTheDocument()
    // Mounting must not write the empty pre-seed bio over the stored one.
    expect(readVerificationDraft(CAMPAIGN_ID)?.profile?.bio).toBe(DRAFT_BIO)
  })

  it('saves what the candidate types', async () => {
    render(<ElectionFilingForm onSubmitted={vi.fn()} persistDraft />)

    fireEvent.change(await screen.findByLabelText('Candidate name'), {
      target: { value: 'Sarah Chen' },
    })
    fireEvent.change(await screen.findByTestId('rich-editor'), {
      target: { value: DRAFT_BIO },
    })

    await waitFor(() =>
      expect(readVerificationDraft(CAMPAIGN_ID)).toMatchObject({
        filing: { candidateName: 'Sarah Chen' },
        profile: { bio: DRAFT_BIO },
      }),
    )
  })

  it('clears the draft once the filing is submitted', async () => {
    const user = userEvent.setup()
    const onSubmitted = vi.fn()
    getUserWebsite.mockResolvedValue(completeWebsite)
    saveVerificationDraft(CAMPAIGN_ID, {
      filing: { candidateName: 'Sarah Chen' },
    })
    render(<ElectionFilingForm onSubmitted={onSubmitted} persistDraft />)

    await screen.findByLabelText('Candidate name')
    await user.click(screen.getByRole('button', { name: 'Submit filing' }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    expect(readVerificationDraft(CAMPAIGN_ID)).toBeNull()
  })

  it('keeps the draft when the filing submit fails', async () => {
    const user = userEvent.setup()
    getUserWebsite.mockResolvedValue(completeWebsite)
    submitTcrCompliance.mockRejectedValue(new Error('nope'))
    render(<ElectionFilingForm onSubmitted={vi.fn()} persistDraft />)

    fireEvent.change(await screen.findByLabelText('Candidate name'), {
      target: { value: 'Sarah Chen' },
    })
    await user.click(screen.getByRole('button', { name: 'Submit filing' }))

    await waitFor(() => expect(submitTcrCompliance).toHaveBeenCalled())
    expect(readVerificationDraft(CAMPAIGN_ID)?.filing).toMatchObject({
      candidateName: 'Sarah Chen',
    })
  })

  it('keeps a valid campaign EIN over a drafted one', async () => {
    mockCampaign.mockReturnValue({
      id: CAMPAIGN_ID,
      details: { einNumber: VALID_EIN },
    } as ReturnType<typeof mockCampaign>)
    saveVerificationDraft(CAMPAIGN_ID, { filing: { ein: '84-2342108' } })
    render(<ElectionFilingForm onSubmitted={vi.fn()} persistDraft />)

    expect(await screen.findByLabelText('EIN')).toHaveValue(VALID_EIN)
  })

  it('restores a drafted EIN when the campaign has none', async () => {
    saveVerificationDraft(CAMPAIGN_ID, { filing: { ein: VALID_EIN } })
    render(<ElectionFilingForm onSubmitted={vi.fn()} persistDraft />)

    expect(await screen.findByLabelText('EIN')).toHaveValue(VALID_EIN)
  })

  it('waits for a late campaign instead of saving over the draft', async () => {
    mockCampaign.mockReturnValue(null)
    saveVerificationDraft(CAMPAIGN_ID, {
      filing: { candidateName: 'Sarah Chen' },
    })
    const { rerender } = render(
      <ElectionFilingForm onSubmitted={vi.fn()} persistDraft />,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    mockCampaign.mockReturnValue({ id: CAMPAIGN_ID, details: {} })
    rerender(<ElectionFilingForm onSubmitted={vi.fn()} persistDraft />)

    expect(await screen.findByLabelText('Candidate name')).toHaveValue(
      'Sarah Chen',
    )
    expect(readVerificationDraft(CAMPAIGN_ID)?.filing).toMatchObject({
      candidateName: 'Sarah Chen',
    })
  })

  it('neither reads nor writes a draft without persistDraft', async () => {
    saveVerificationDraft(CAMPAIGN_ID, {
      filing: { candidateName: 'Sarah Chen' },
    })
    render(<ElectionFilingForm onSubmitted={vi.fn()} />)

    const name = await screen.findByLabelText('Candidate name')
    expect(name).toHaveValue('')
    fireEvent.change(name, { target: { value: 'Someone else' } })

    expect(readVerificationDraft(CAMPAIGN_ID)?.filing).toEqual({
      candidateName: 'Sarah Chen',
    })
  })
})
