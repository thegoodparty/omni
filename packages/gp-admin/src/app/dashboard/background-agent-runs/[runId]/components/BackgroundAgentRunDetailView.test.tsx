import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import type { BackgroundAgentRunDetail } from '@/shared/gpApi'
import { BackgroundAgentRunDetailView } from './BackgroundAgentRunDetailView'

const detail = (
  overrides: Partial<BackgroundAgentRunDetail> = {}
): BackgroundAgentRunDetail => ({
  runId: 'run_1',
  agentName: 'trending_issues',
  organizationSlug: 'acme',
  status: 'failed',
  input: { organizationSlug: 'acme', topic: 'zoning' },
  artifact: null,
  error: 'the step budget ran out',
  shapeHash: 'shape-1',
  durationSeconds: 150,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  startedAt: new Date('2026-06-01T00:00:10.000Z'),
  finishedAt: new Date('2026-06-01T00:02:40.000Z'),
  messages: [
    {
      index: 0,
      role: 'user',
      parts: [{ type: 'text', text: '{"topic":"zoning"}' }],
      model: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      createdAt: new Date('2026-06-01T00:00:10.000Z'),
    },
    {
      index: 1,
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Searching the news.' },
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'webSearch',
          input: { query: 'zoning' },
        },
      ],
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      createdAt: new Date('2026-06-01T00:00:20.000Z'),
    },
    {
      index: 2,
      role: 'tool',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'webSearch',
          output: { type: 'json', value: [] },
        },
      ],
      model: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      createdAt: new Date('2026-06-01T00:00:30.000Z'),
    },
  ],
  ...overrides,
})

describe('BackgroundAgentRunDetailView', () => {
  it('shows the status, input, error and shape hash', () => {
    render(
      <Theme>
        <BackgroundAgentRunDetailView detail={detail()} />
      </Theme>
    )

    expect(
      screen.getByRole('heading', { name: 'trending_issues' })
    ).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('the step budget ran out')).toBeInTheDocument()
    expect(screen.getByText('shape-1')).toBeInTheDocument()
    expect(screen.getByText(/"topic": "zoning"/)).toBeInTheDocument()
  })

  it('renders the artifact JSON once the run produced one', () => {
    render(
      <Theme>
        <BackgroundAgentRunDetailView
          detail={detail({ artifact: { trending: ['housing'] } })}
        />
      </Theme>
    )

    expect(screen.getByText(/"housing"/)).toBeInTheDocument()
  })

  it('says the artifact is absent rather than rendering an empty block', () => {
    render(
      <Theme>
        <BackgroundAgentRunDetailView detail={detail()} />
      </Theme>
    )

    expect(
      screen.getByText('No artifact yet. The run may still be in progress.')
    ).toBeInTheDocument()
  })

  it('renders the transcript by role, with tool calls and results collapsed', () => {
    render(
      <Theme>
        <BackgroundAgentRunDetailView detail={detail()} />
      </Theme>
    )

    expect(screen.getByText('Searching the news.')).toBeInTheDocument()
    expect(
      screen.getByText(/#1 · assistant · claude-sonnet-4-6/)
    ).toBeInTheDocument()
    expect(screen.getByText(/#2 · tool/)).toBeInTheDocument()

    // <details> without `open` is the collapsed state: the summary is visible
    // and the JSON inside is not.
    const call = screen.getByText('Call webSearch').closest('details')
    const result = screen.getByText('Result webSearch').closest('details')
    expect(call).not.toHaveAttribute('open')
    expect(result).not.toHaveAttribute('open')
  })

  it('says so when a run recorded no messages', () => {
    render(
      <Theme>
        <BackgroundAgentRunDetailView detail={detail({ messages: [] })} />
      </Theme>
    )

    expect(
      screen.getByText('No messages recorded for this run.')
    ).toBeInTheDocument()
  })
})
