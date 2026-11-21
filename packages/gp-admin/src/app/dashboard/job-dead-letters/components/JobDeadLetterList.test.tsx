import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { JobDeadLetterList } from './JobDeadLetterList'

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
  it('shows the queue, the last error, the retries and when it died', () => {
    render(
      <Theme>
        <JobDeadLetterList deadLetters={[deadLetter()]} />
      </Theme>
    )

    expect(screen.getByText('doorKnockingCanvassingTotals')).toBeInTheDocument()
    expect(screen.getByText('Segment is down')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('links the queue to the dead letter detail page', () => {
    render(
      <Theme>
        <JobDeadLetterList deadLetters={[deadLetter()]} />
      </Theme>
    )

    expect(
      screen.getByRole('link', {
        name: 'doorKnockingCanvassingTotals',
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
})
