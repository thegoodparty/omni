import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { fireEvent, screen } from '@testing-library/react'
import type { Priority } from '@goodparty_org/contracts'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import PrioritiesHub from './PrioritiesHub'
import { listPriorities } from '../data/priorities-api'

vi.mock('../data/priorities-api', () => ({
  listPriorities: vi.fn(),
  archivePriority: vi.fn(),
  prioritizeCommunityIssue: vi.fn(),
  createPriority: vi.fn(),
}))

const priority = (overrides: Partial<Priority> = {}): Priority => ({
  id: 'p1',
  electedOfficeId: 'eo1',
  title: 'Fix the flooding on Oak Street',
  description: 'Two blocks flood every heavy rain.',
  source: 'user_stated',
  sourceCampaignPositionId: null,
  currentStep: 'define',
  nextAction: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const issue = (
  overrides: Partial<CommunityIssueCard> = {},
): CommunityIssueCard => ({
  id: 'i1',
  list: 'top_community',
  category: 'infrastructure',
  priority: 'high',
  title: 'Sidewalk gaps near the school',
  summary: 'Parents raise this at every meeting.',
  rank: 1,
  prioritized: false,
  ...overrides,
})

describe('PrioritiesHub', () => {
  beforeEach(() => {
    vi.mocked(listPriorities).mockReturnValue(
      new Promise<Priority[]>(() => undefined),
    )
  })

  it('replaces a list restored from cache with the current one', async () => {
    vi.mocked(listPriorities).mockResolvedValue([
      priority({ currentStep: 'evidence' }),
      priority({ id: 'p2', title: 'Added since' }),
    ])
    render(<PrioritiesHub priorities={[priority()]} seedIssues={[]} />)
    expect(await screen.findByText('Added since')).toBeInTheDocument()
    expect(screen.getByText('What we know')).toBeInTheDocument()
  })

  it('tells the user what to do when they hold no priorities', () => {
    render(<PrioritiesHub priorities={[]} seedIssues={[]} />)
    expect(
      screen.getByText(/Add what you want to get done/),
    ).toBeInTheDocument()
  })

  it('ranks the priorities it was given', () => {
    render(
      <PrioritiesHub
        priorities={[priority(), priority({ id: 'p2', title: 'Speed humps' })]}
        seedIssues={[]}
      />,
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Speed humps')).toBeInTheDocument()
  })

  it('offers only the issues the user has not already picked up', () => {
    render(
      <PrioritiesHub
        priorities={[]}
        seedIssues={[
          issue(),
          issue({ id: 'i2', title: 'Already mine', prioritized: true }),
        ]}
      />,
    )
    expect(
      screen.getByText('Sidewalk gaps near the school'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Already mine')).not.toBeInTheDocument()
  })

  it('badges each row with the lane it came from', () => {
    render(
      <PrioritiesHub
        priorities={[
          priority({ source: 'community_issue' }),
          priority({ id: 'p2', title: 'Speed humps', source: 'user_stated' }),
        ]}
        seedIssues={[]}
      />,
    )
    // The lane chips carry a count, the row badges do not, so the badge is the
    // bare label.
    expect(screen.getByText('From your community')).toBeInTheDocument()
    expect(screen.getByText('Yours')).toBeInTheDocument()
  })

  it('filters to one lane and empties honestly when it holds nothing', () => {
    render(
      <PrioritiesHub
        priorities={[priority({ source: 'user_stated' })]}
        seedIssues={[]}
      />,
    )
    fireEvent.click(screen.getByText('From your community (0)'))
    expect(screen.getByText('Nothing in this lane yet.')).toBeInTheDocument()
    expect(
      screen.queryByText('Fix the flooding on Oak Street'),
    ).not.toBeInTheDocument()
  })

  it('shows the next action on a row that has one', () => {
    render(
      <PrioritiesHub
        priorities={[
          priority({ nextAction: 'Ask the county engineer for the survey.' }),
        ]}
        seedIssues={[]}
      />,
    )
    expect(
      screen.getByText('Ask the county engineer for the survey.'),
    ).toBeInTheDocument()
  })

  it('shows nothing in place of a next action a priority does not have', () => {
    render(
      <PrioritiesHub
        priorities={[priority({ nextAction: null })]}
        seedIssues={[]}
      />,
    )
    expect(
      screen.getByText('Fix the flooding on Oak Street'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/next action/i)).not.toBeInTheDocument()
  })

  it('names the step a priority is on, and says the plan is ready when there is none', () => {
    render(
      <PrioritiesHub
        priorities={[
          priority({ currentStep: 'evidence' }),
          priority({ id: 'p2', title: 'Speed humps', currentStep: null }),
        ]}
        seedIssues={[]}
      />,
    )
    expect(screen.getByText('What we know')).toBeInTheDocument()
    expect(screen.getByText('Plan ready')).toBeInTheDocument()
  })

  it('gives every row its own archive control', () => {
    render(
      <PrioritiesHub
        priorities={[priority(), priority({ id: 'p2', title: 'Speed humps' })]}
        seedIssues={[]}
      />,
    )
    expect(
      screen.getByRole('button', {
        name: 'Archive Fix the flooding on Oak Street',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Archive Speed humps' }),
    ).toBeInTheDocument()
  })
})
