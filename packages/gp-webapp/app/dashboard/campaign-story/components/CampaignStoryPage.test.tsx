import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { WebsiteIssue } from 'helpers/types'
import type { CampaignStorySection } from './CampaignStoryCard'
import CampaignStoryPage from './CampaignStoryPage'

const { mockSaveAboutFields } = vi.hoisted(() => ({
  mockSaveAboutFields: vi.fn(),
}))

vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
// Expose buttons that fire onAnsweredChange so tests can drive the dynamic
// footer the same way real card saves would.
vi.mock('./CampaignStoryCard', () => ({
  default: ({
    section,
    onAnsweredChange,
  }: {
    section: CampaignStorySection
    onAnsweredChange?: (answered: boolean) => void
  }) => (
    <div>
      <button type="button" onClick={() => onAnsweredChange?.(true)}>
        answer-{section.id}
      </button>
      <button type="button" onClick={() => onAnsweredChange?.(false)}>
        clear-{section.id}
      </button>
    </div>
  ),
}))
// Drive the issues count without mounting the Quill-based policy editor.
vi.mock(
  'app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities',
  () => ({
    default: ({
      issues,
      onChange,
    }: {
      issues: WebsiteIssue[]
      onChange: (issues: WebsiteIssue[]) => void
    }) => (
      <div>
        <span>issue-count:{issues.length}</span>
        <button
          type="button"
          onClick={() => onChange([{ title: 't', description: 'd' }])}
        >
          add-issue
        </button>
        <button type="button" onClick={() => onChange([])}>
          clear-issues
        </button>
      </div>
    ),
  }),
)
vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/dashboard/website/util/website.util')
    >()
  return { ...actual, saveAboutFields: mockSaveAboutFields }
})
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

const story = { why: 'w', background: 'b' }
const incompleteStory = { why: 'w', background: '' }
const oneIssue: WebsiteIssue[] = [{ title: 't', description: 'd' }]

const footerLink = () =>
  screen.queryByRole('link', { name: 'Generate my Campaign Plan' })

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveAboutFields.mockResolvedValue(true)
})

describe('CampaignStoryPage', () => {
  it('hides the generate footer when there are no issues, even with a complete story', () => {
    render(<CampaignStoryPage initialStory={story} initialIssues={[]} />)
    expect(footerLink()).not.toBeInTheDocument()
  })

  it('shows the generate footer when the story is complete and an issue exists', () => {
    render(<CampaignStoryPage initialStory={story} initialIssues={oneIssue} />)
    expect(footerLink()).toHaveAttribute('href', '/dashboard/campaign-plan')
  })

  it('reveals the footer once both cards are answered and an issue is added', async () => {
    const user = userEvent.setup()
    render(
      <CampaignStoryPage initialStory={incompleteStory} initialIssues={[]} />,
    )
    expect(footerLink()).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'answer-background' }))
    await user.click(screen.getByRole('button', { name: 'add-issue' }))

    expect(footerLink()).toHaveAttribute('href', '/dashboard/campaign-plan')
  })

  it('hides the footer when the only issue is removed', async () => {
    const user = userEvent.setup()
    render(<CampaignStoryPage initialStory={story} initialIssues={oneIssue} />)
    expect(footerLink()).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'clear-issues' }))

    expect(footerLink()).not.toBeInTheDocument()
  })

  it('persists issues to the website on change', async () => {
    const user = userEvent.setup()
    render(<CampaignStoryPage initialStory={story} initialIssues={[]} />)

    await user.click(screen.getByRole('button', { name: 'add-issue' }))

    expect(mockSaveAboutFields).toHaveBeenCalledWith({
      issues: [{ title: 't', description: 'd' }],
    })
  })

  it('reverts the issue and keeps the footer hidden when the save fails', async () => {
    mockSaveAboutFields.mockResolvedValue(false)
    const user = userEvent.setup()
    render(<CampaignStoryPage initialStory={story} initialIssues={[]} />)

    await user.click(screen.getByRole('button', { name: 'add-issue' }))

    // Optimistic add is reverted once the save resolves false.
    await waitFor(() =>
      expect(screen.getByText('issue-count:0')).toBeInTheDocument(),
    )
    expect(footerLink()).not.toBeInTheDocument()
  })
})
