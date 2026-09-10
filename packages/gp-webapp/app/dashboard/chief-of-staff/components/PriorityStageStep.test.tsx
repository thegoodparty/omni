import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Priority } from '@goodparty_org/contracts'
import PriorityStageStep from './PriorityStageStep'

const setStageMock = vi.fn()
vi.mock('../data/use-priorities', () => ({
  useSetPriorityStage: () => ({ mutate: setStageMock, isPending: false }),
}))

const priority: Priority = {
  id: 'p1',
  electedOfficeId: 'eo1',
  title: 'Short-term rentals',
  description: 'Rents climbing as units convert to nightly stays.',
  source: 'community_issue',
  sourceCampaignPositionId: null,
  stage: null,
  targetDate: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

beforeEach(() => {
  setStageMock.mockReset()
})

describe('PriorityStageStep', () => {
  it('asks where they are, naming the priority back', async () => {
    render(<PriorityStageStep priority={priority} />)

    expect(
      await screen.findByText(
        /Got it, short-term rentals\. Where are you with it right now\?/,
      ),
    ).toBeInTheDocument()
  })

  it('offers the four stages in order', () => {
    render(<PriorityStageStep priority={priority} />)

    const options = screen.getAllByRole('button').map((b) => b.textContent)
    expect(options).toHaveLength(4)
    expect(options[0]).toMatch(/started on it a bit/)
    expect(options[1]).toMatch(/talked to constituents/)
    expect(options[2]).toMatch(/need help shaping it/)
    expect(options[3]).toMatch(/going up for a vote/)
  })

  it.each([
    [/started on it a bit/, 'exploring'],
    [/talked to constituents/, 'gathering_input'],
    [/need help shaping it/, 'shaping'],
    [/going up for a vote/, 'ready_for_vote'],
  ])('records %s as %s', async (label, stage) => {
    const user = userEvent.setup()
    render(<PriorityStageStep priority={priority} />)

    await user.click(screen.getByRole('button', { name: label }))

    // Persisted against the priority, not remembered locally — the agent reads
    // it back through crud_priorities rather than asking again.
    expect(setStageMock).toHaveBeenCalledWith({ id: 'p1', stage })
  })
})
