import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { SendActions } from './SendActions'

const { refresh, resumeEmailSend, cancelEmailSend, showToast } = vi.hoisted(
  () => ({
    refresh: vi.fn(),
    resumeEmailSend: vi.fn(),
    cancelEmailSend: vi.fn(),
    showToast: vi.fn(),
  })
)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../actions', () => ({ resumeEmailSend, cancelEmailSend }))

const renderActions = (canResume: boolean) =>
  render(
    <Theme>
      <SendActions outreachId={7} canResume={canResume} />
    </Theme>
  )

describe('SendActions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hides Resume when SES paused the sender', () => {
    renderActions(false)
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('resumes and refreshes', async () => {
    resumeEmailSend.mockResolvedValue({ error: null })
    renderActions(true)
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(resumeEmailSend).toHaveBeenCalledWith(7)
    expect(refresh).toHaveBeenCalled()
  })

  it("shows gp-api's refusal on a failed resume", async () => {
    resumeEmailSend.mockResolvedValue({ error: 'This send is not paused' })
    renderActions(true)
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText('This send is not paused')).toBeTruthy()
  })
})
