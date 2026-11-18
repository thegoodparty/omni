import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import type { BackgroundAgentRunListItem } from '@/shared/gpApi'
import { BackgroundAgentRunList } from './BackgroundAgentRunList'

const run = (
  overrides: Partial<BackgroundAgentRunListItem> = {}
): BackgroundAgentRunListItem => ({
  runId: 'run_1',
  agentName: 'trending_issues',
  organizationSlug: 'acme',
  status: 'completed',
  durationSeconds: 150,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  ...overrides,
})

describe('BackgroundAgentRunList', () => {
  it('renders the agent, organization, status, duration and created date', () => {
    render(
      <Theme>
        <BackgroundAgentRunList runs={[run()]} />
      </Theme>
    )

    expect(screen.getByText('trending_issues')).toBeInTheDocument()
    expect(screen.getByText('acme')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('2m 30s')).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('links the agent name to the run detail page', () => {
    render(
      <Theme>
        <BackgroundAgentRunList runs={[run()]} />
      </Theme>
    )

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/dashboard/background-agent-runs/run_1'
    )
  })

  it('dashes a duration the run has not finished with', () => {
    render(
      <Theme>
        <BackgroundAgentRunList runs={[run({ durationSeconds: null })]} />
      </Theme>
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('has no cost column, because no cost is stored', () => {
    render(
      <Theme>
        <BackgroundAgentRunList runs={[run()]} />
      </Theme>
    )

    expect(screen.queryByText('Cost')).not.toBeInTheDocument()
  })

  it('says so when the filters match nothing', () => {
    render(
      <Theme>
        <BackgroundAgentRunList runs={[]} />
      </Theme>
    )

    expect(
      screen.getByText('No agent runs found matching your filters.')
    ).toBeInTheDocument()
  })
})
