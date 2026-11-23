import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { JobDeadLetterList } from './JobDeadLetterList'

const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}))
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))
vi.mock('../actions', () => ({
  redriveJobDeadLetter: vi.fn().mockResolvedValue({ error: null }),
  deleteJobDeadLetter: vi.fn().mockResolvedValue({ error: null }),
  redriveJobDeadLetters: vi
    .fn()
    .mockResolvedValue({ redriven: [], failed: [] }),
  deleteJobDeadLetters: vi.fn().mockResolvedValue({ deleted: [], failed: [] }),
}))

const ID = 'af726827-f099-4385-934e-36d00c2d540e'

const deadLetter = (overrides: Partial<JobDeadLetter> = {}): JobDeadLetter => ({
  id: ID,
  sourceQueue: 'doorKnockingCanvassingTotals',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
  retriesUsed: 2,
  data: { organizationSlug: 'acme' },
  error: 'Segment is down',
  ...overrides,
})

const renderList = (deadLetters: JobDeadLetter[]) =>
  render(
    <Theme>
      <JobDeadLetterList deadLetters={deadLetters} />
    </Theme>
  )

describe('JobDeadLetterList', () => {
  it('shows the queue, the last error and when it died', () => {
    renderList([deadLetter()])

    expect(screen.getByText('doorKnockingCanvassingTotals')).toBeInTheDocument()
    expect(screen.getByText('Segment is down')).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('shortens the id to one short line but links to the whole one', () => {
    renderList([deadLetter()])

    const link = screen.getByRole('link', { name: 'af726…540e' })

    expect(link).toHaveAttribute('href', `/dashboard/job-dead-letters/${ID}`)
    expect(link).toHaveAttribute('title', ID)
  })

  it('puts died before the actions rather than last in the queue columns', () => {
    renderList([deadLetter()])

    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent?.trim())

    expect(headers).toContain('Died')
    expect(headers.indexOf('Died')).toBeGreaterThan(headers.indexOf('Error'))
  })

  it('offers no re-drive for a dead letter with no source queue', () => {
    renderList([deadLetter({ sourceQueue: null, error: null })])

    expect(screen.getByText('Unknown queue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-drive/i })).toBeDisabled()
  })

  it('offers delete on every row, including one that cannot be re-driven', () => {
    renderList([deadLetter({ sourceQueue: null })])

    expect(screen.getByRole('button', { name: /delete/i })).toBeEnabled()
  })

  it('says so when there are no dead letters', () => {
    renderList([])

    expect(screen.getByText('No dead letters right now.')).toBeInTheDocument()
  })

  it('selects one row and offers the batch actions for it', async () => {
    renderList([
      deadLetter({ id: 'aaaaaaaa-0000-4000-8000-000000000000' }),
      deadLetter({ id: 'bbbbbbbb-0000-4000-8000-000000000000' }),
    ])

    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select dead letter aaaaaaaa-0000-4000-8000-000000000000',
      })
    )

    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /re-drive 1/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /delete 1/i })
    ).toBeInTheDocument()
  })

  it('selects every row from the header checkbox', async () => {
    renderList([
      deadLetter({ id: 'aaaaaaaa-0000-4000-8000-000000000000' }),
      deadLetter({ id: 'bbbbbbbb-0000-4000-8000-000000000000' }),
    ])

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select all dead letters' })
    )

    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('drops the batch bar when the last row is deselected', async () => {
    renderList([deadLetter()])
    const rowCheckbox = screen.getByRole('checkbox', {
      name: `Select dead letter ${ID}`,
    })

    await userEvent.click(rowCheckbox)
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await userEvent.click(rowCheckbox)
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })
})
