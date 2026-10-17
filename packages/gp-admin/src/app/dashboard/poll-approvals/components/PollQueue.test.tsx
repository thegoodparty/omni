import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import type { PollQueueItem } from '@goodparty_org/contracts'
import { PollQueue } from './PollQueue'

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const item = (overrides: Partial<PollQueueItem>): PollQueueItem => ({
  kind: 'poll',
  outreachId: 7,
  expansionId: null,
  organizationSlug: 'jane-doe-org',
  name: 'Poll one',
  question: 'Should the town fund the new library?',
  topic: 'budget',
  textCount: 1200,
  sendAt: new Date('2026-09-10T15:00:00Z'),
  createdAt: new Date('2026-09-01T00:00:00Z'),
  approvalStatus: 'awaiting_review',
  approvedAt: null,
  approvedBy: null,
  deniedAt: null,
  deniedBy: null,
  deniedReason: null,
  ...overrides,
})

const renderQueue = (items: PollQueueItem[]) =>
  render(
    <Theme>
      <PollQueue items={items} />
    </Theme>
  )

describe('PollQueue', () => {
  it('counts each tab and shows the expansion badge on expansion rows', async () => {
    renderQueue([
      item({}),
      item({
        kind: 'expansion',
        outreachId: 8,
        expansionId: 'exp-1',
        question: 'Expanded poll question text',
      }),
      item({ outreachId: 9, approvalStatus: 'approved' }),
      item({ outreachId: 10, approvalStatus: 'sent' }),
      item({ outreachId: 11, approvalStatus: 'denied' }),
      item({ outreachId: 12, approvalStatus: 'canceled' }),
    ])

    expect(
      screen.getByRole('tab', { name: /Awaiting review \(2\)/ })
    ).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Approved \(2\)/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Denied \(1\)/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Canceled \(1\)/ })).toBeTruthy()
    expect(screen.getByText('Expansion')).toBeTruthy()
    expect(
      screen.getByText('Should the town fund the new library?')
    ).toBeTruthy()
    expect(screen.getAllByText('1,200')).toBeTruthy()

    await userEvent.click(screen.getByRole('tab', { name: /Denied \(1\)/ }))
    expect(screen.queryByText('Expansion')).toBeNull()
  })

  it('opens the review page for a row', async () => {
    renderQueue([item({})])
    await userEvent.click(screen.getByText('Poll one'))
    expect(mockPush).toHaveBeenCalledWith('/dashboard/poll-approvals/7')
  })
})
