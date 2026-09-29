import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { ChatMessageSegment } from './chatTypes'
import {
  composeHandoffWidgetTool,
  type ComposeHandoffWidgetContext,
} from './composeHandoffWidget'
import { TurnBlocks, persistedTurnBlocks } from './turnBlocks'
import { createWidgetRegistry } from './widgetRegistry'

const registry = createWidgetRegistry<ComposeHandoffWidgetContext>([
  composeHandoffWidgetTool,
])

const validHandoffPayload = {
  channel: 'serve_social' as const,
  draftText: 'Here is a draft social post for you to review.',
  purpose: 'Update constituents on the water bill',
}

const renderTurn = (
  segments: ChatMessageSegment[],
  onComposeHandoff = vi.fn(),
  toolLabel: (name: string) => string | null = (name) => name,
) =>
  render(
    <TurnBlocks
      blocks={persistedTurnBlocks({
        registry,
        segments,
        content: '',
        messageId: 'm1',
      })}
      toolLabel={toolLabel}
      context={{ onComposeHandoff }}
    />,
  )

describe('composeHandoffWidgetTool', () => {
  it('renders a CTA card for a valid compose_handoff segment', () => {
    renderTurn([
      {
        kind: 'tool',
        toolName: 'compose_handoff',
        payload: validHandoffPayload,
      },
    ])
    expect(
      screen.getByRole('button', { name: 'Continue in compose' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Social Post')).toBeInTheDocument()
  })

  it('calls onComposeHandoff with the parsed payload when the button is clicked', () => {
    const onComposeHandoff = vi.fn()
    renderTurn(
      [
        {
          kind: 'tool',
          toolName: 'compose_handoff',
          payload: validHandoffPayload,
        },
      ],
      onComposeHandoff,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue in compose' }))
    expect(onComposeHandoff).toHaveBeenCalledWith(validHandoffPayload)
  })

  it('renders nothing, and no pill, when the payload fails to parse', () => {
    renderTurn([
      {
        kind: 'tool',
        toolName: 'compose_handoff',
        payload: { channel: 'unknown_channel', draftText: 'hello' },
      },
    ])
    // The label map falls back to the raw name, as Chief of Staff's does, so
    // a pill here would expose the internal tool name.
    expect(
      screen.queryByRole('button', { name: 'Continue in compose' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('compose_handoff')).not.toBeInTheDocument()
  })

  it('does not affect other tool segments', () => {
    renderTurn(
      [{ kind: 'tool', toolName: 'search_contacts' }],
      vi.fn(),
      () => 'Searching',
    )
    expect(
      screen.queryByRole('button', { name: 'Continue in compose' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Searching')).toBeInTheDocument()
  })
})
