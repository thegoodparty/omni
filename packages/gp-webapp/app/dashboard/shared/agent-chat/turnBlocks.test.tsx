import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ChatMessageSegment } from './chatClient'
import { TurnBlocks, liveTurnBlocks, persistedTurnBlocks } from './turnBlocks'
import { createWidgetRegistry, defineWidgetTool } from './widgetRegistry'

type Ctx = { label: string }

const registry = createWidgetRegistry<Ctx>([
  defineWidgetTool({
    toolName: 'present_note',
    parse: (args, call) =>
      typeof args === 'object' &&
      args !== null &&
      'note' in args &&
      typeof args.note === 'string'
        ? { note: args.note, id: `${call.conversationId}:${call.toolCallId}` }
        : null,
    render: (data, ctx) => (
      <p>
        {ctx.label} {data.note} {data.id}
      </p>
    ),
  }),
  defineWidgetTool({
    toolName: 'maybe_card',
    onParseFailure: 'inline',
    parse: (args) =>
      typeof args === 'object' && args !== null && 'card' in args
        ? { card: true }
        : null,
    render: () => <p>card</p>,
  }),
])

const toolLabel = (name: string) => `pill:${name}`

const renderBlocks = (segments: ChatMessageSegment[]) =>
  render(
    <TurnBlocks
      blocks={persistedTurnBlocks({
        registry,
        segments,
        content: '',
        messageId: 'm1',
        conversationId: 'c1',
      })}
      toolLabel={toolLabel}
      context={{ label: 'ctx' }}
    />,
  )

describe('persistedTurnBlocks', () => {
  it('renders a widget between prose with the identity and surface context', () => {
    renderBlocks([
      { kind: 'text', text: 'Above.' },
      {
        kind: 'tool',
        toolName: 'present_note',
        toolCallId: 't1',
        payload: { note: 'hi' },
      },
      { kind: 'text', text: 'Below.' },
    ])
    const widget = screen.getByText('ctx hi c1:t1')
    const above = screen.getByText('Above.')
    const below = screen.getByText('Below.')
    expect(
      above.compareDocumentPosition(widget) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      widget.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('hides a registered tool whose args do not parse', () => {
    renderBlocks([
      { kind: 'text', text: 'Prose.' },
      { kind: 'tool', toolName: 'present_note', payload: { nope: 1 } },
    ])
    expect(screen.getByText('Prose.')).toBeVisible()
    expect(screen.queryByText('pill:present_note')).not.toBeInTheDocument()
  })

  it('leaves an unparsed inline-fallback tool as an ordinary pill', () => {
    renderBlocks([{ kind: 'tool', toolName: 'maybe_card', payload: {} }])
    expect(screen.getByText('pill:maybe_card')).toBeVisible()
    expect(screen.queryByText('card')).not.toBeInTheDocument()
  })

  it('treats an unknown tool as an ordinary tool rather than throwing', () => {
    renderBlocks([
      { kind: 'tool', toolName: 'from_a_newer_build', payload: { x: 1 } },
    ])
    expect(screen.getByText('pill:from_a_newer_build')).toBeVisible()
  })
})

describe('liveTurnBlocks', () => {
  it('splits a text segment at the seam a widget fired, and holds it back until revealed', () => {
    const instance = registry.resolve(
      { toolName: 'present_note', conversationId: 'c1', toolCallId: 't1' },
      { note: 'hi' },
    )
    if (!instance) throw new Error('expected instance')
    const segments = [{ kind: 'text' as const, text: 'Lead in. After.' }]
    const widgets = [{ instance, appearAfter: 9 }]

    expect(liveTurnBlocks(segments, widgets, 5).map((b) => b.kind)).toEqual([
      'segments',
    ])
    expect(
      liveTurnBlocks(segments, widgets, 15).map((b) =>
        b.kind === 'segments'
          ? b.segments.map((s) => (s.kind === 'text' ? s.text : s.kind))
          : 'widget',
      ),
    ).toEqual([['Lead in. '], 'widget', ['After.']])
  })
})
