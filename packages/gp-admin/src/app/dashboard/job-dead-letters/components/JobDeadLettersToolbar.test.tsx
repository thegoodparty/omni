import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { JobDeadLettersToolbar } from './JobDeadLettersToolbar'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('page=3'),
}))

const renderToolbar = (sourceQueue?: string) =>
  render(
    <Theme>
      <JobDeadLettersToolbar
        sourceQueue={sourceQueue}
        queues={['contactUploadProcess', 'doorKnockingCanvassingTotals']}
      />
    </Theme>
  )

describe('JobDeadLettersToolbar', () => {
  it('offers no Apply button, because the choice is the filter', () => {
    renderToolbar()

    expect(
      screen.queryByRole('button', { name: /apply filter/i })
    ).not.toBeInTheDocument()
  })

  it('filters as soon as a queue is picked, and resets the page', async () => {
    renderToolbar()

    await userEvent.click(
      screen.getByRole('combobox', { name: /source queue/i })
    )
    await userEvent.click(
      await screen.findByRole('option', { name: 'contactUploadProcess' })
    )

    expect(push).toHaveBeenCalledWith(
      '/dashboard/job-dead-letters?source_queue=contactUploadProcess'
    )
  })

  it('still lists the active filter after its last dead letter is gone', async () => {
    renderToolbar('emptiedQueue')

    await userEvent.click(
      screen.getByRole('combobox', { name: /source queue/i })
    )

    expect(
      await screen.findByRole('option', { name: 'emptiedQueue' })
    ).toBeInTheDocument()
  })

  it('clears the filter when All queues is picked', async () => {
    renderToolbar('contactUploadProcess')

    await userEvent.click(
      screen.getByRole('combobox', { name: /source queue/i })
    )
    await userEvent.click(
      await screen.findByRole('option', { name: 'All queues' })
    )

    expect(push).toHaveBeenCalledWith('/dashboard/job-dead-letters')
  })
})
