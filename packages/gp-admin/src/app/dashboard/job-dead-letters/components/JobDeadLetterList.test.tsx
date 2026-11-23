import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { JobDeadLetterList } from './JobDeadLetterList'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

const deadLetter = (overrides: Partial<JobDeadLetter> = {}): JobDeadLetter => ({
  id: '5f1a4b26-7c8a-4f5d-9a0b-0f0f5b5f1a4b',
  sourceQueue: 'doorKnockingCanvassingTotals',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
  retriesUsed: 2,
  data: { organizationSlug: 'acme' },
  error: 'Segment is down',
  ...overrides,
})

describe('JobDeadLetterList', () => {
  it('shows the id, the queue, the last error and when it died', () => {
    render(
      <Theme>
        <JobDeadLetterList deadLetters={[deadLetter()]} />
      </Theme>
    )

    expect(screen.getByText('doorKnockingCanvassingTotals')).toBeInTheDocument()
    expect(screen.getByText('Segment is down')).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('links the id to the dead letter detail page', () => {
    render(
      <Theme>
        <JobDeadLetterList deadLetters={[deadLetter()]} />
      </Theme>
    )

    expect(
      screen.getByRole('link', {
        name: '5f1a…f1a4b',
      })
    ).toHaveAttribute(
      'href',
      '/dashboard/job-dead-letters/5f1a4b26-7c8a-4f5d-9a0b-0f0f5b5f1a4b'
    )
  })

  it('offers no re-drive for a dead letter with no source queue', () => {
    render(
      <Theme>
        <JobDeadLetterList
          deadLetters={[deadLetter({ sourceQueue: null, error: null })]}
        />
      </Theme>
    )

    expect(screen.getByText('Unknown queue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-drive/i })).toBeDisabled()
  })

  it('says so when there are no dead letters', () => {
    render(
      <Theme>
        <JobDeadLetterList deadLetters={[]} />
      </Theme>
    )

    expect(screen.getByText('No dead letters right now.')).toBeInTheDocument()
  })

  it('offers bulk actions once a row is selected', async () => {
    render(
      <Theme>
        <JobDeadLetterList deadLetters={[deadLetter()]} />
      </Theme>
    )

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))

    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })
})
