import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { EmailFlowPage } from './EmailFlowPage'
import { EmailStatusPage } from './EmailStatusPage'

vi.mock('app/shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

const send = (status: string) => ({
  id: 12,
  status,
  goal: 'Introduce myself to voters',
  layout: '',
  theme: '',
  subject: '',
  headline: null,
  body: '',
  imageUrl: null,
  buttonLabel: null,
  buttonUrl: null,
  paidForBy: null,
  date: null,
  voterFileFilterId: null,
  recipientCount: 0,
  content: {
    layout: 'personal_letter' as const,
    theme: 'classic_blue' as const,
    subject: 'Hello',
    blocks: [{ type: 'paragraph' as const, text: 'Hi there' }],
  },
  recipientCap: null,
  priceCents: null,
  sentCount: 0,
  pauseReason: null,
  stopping: false,
  estimate: null,
  deliveryCounts: null,
})

const mockSend = (status: string) => {
  api.mock('GET /v1/outreach/email/:id', { status: 200, data: send(status) })
  api.mock('GET /v1/outreach/email/sender', {
    status: 200,
    data: {
      localPart: 'renee.wells',
      address: 'renee.wells@outreachmail.goodparty.org',
      displayName: 'Renee Wells',
      forwardToEmail: 'renee@example.com',
      pendingForwardToEmail: null,
      warmingStep: 0,
    },
  })
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
}

describe('EmailFlowPage with a draft id', () => {
  beforeEach(() => {
    router.replace?.mockClear()
    router.push?.mockClear()
  })

  it('reopens a draft in the flow', async () => {
    mockSend('draft')
    render(<EmailFlowPage draftId={12} />)

    expect(
      await screen.findByText(/Choose a (voter|constituent) list/),
    ).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('sends an email that is not a draft to its status page', async () => {
    mockSend('pending')
    render(<EmailFlowPage draftId={12} />)

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        '/dashboard/outreach/email/12',
      ),
    )
  })
})

describe('EmailStatusPage', () => {
  beforeEach(() => router.push?.mockClear())

  it('takes a draft back into the flow', async () => {
    mockSend('draft')
    const user = userEvent.setup()
    render(<EmailStatusPage id={12} />)

    await user.click(
      await screen.findByRole('button', { name: 'Schedule email' }),
    )

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/outreach/email?draft=12',
    )
  })

  it('keeps Done for an email that is not a draft', async () => {
    mockSend('pending')
    render(<EmailStatusPage id={12} />)

    await screen.findByText('Scheduled.')
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Schedule email' })).toBeNull()
  })
})
