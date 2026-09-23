import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent } from '@testing-library/react'
import { CitationChip, InlineSegments } from './chatUI'
import type { LiveSegment } from './streaming'

// ---------------------------------------------------------------------------
// CitationChip
// ---------------------------------------------------------------------------

describe('CitationChip', () => {
  it('renders the ordinal as static text when no click handler is provided', () => {
    render(<CitationChip ordinal={1} />)
    expect(screen.getByText('[1]')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders as a button when a click handler is provided', () => {
    render(<CitationChip ordinal={2} onCitationClick={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Open source 2' }),
    ).toBeInTheDocument()
  })

  it('calls onCitationClick when the button is clicked', () => {
    const onClick = vi.fn()
    render(<CitationChip ordinal={3} onCitationClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open source 3' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows the correct ordinal in the button label', () => {
    render(<CitationChip ordinal={7} onCitationClick={vi.fn()} />)
    expect(screen.getByText('[7]')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open source 7' }),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// InlineSegments — citation rendering
// ---------------------------------------------------------------------------

const noop = () => null

describe('InlineSegments — citation chips', () => {
  it('renders a static citation chip when onCitationClick is not provided', () => {
    const segments: LiveSegment[] = [
      {
        kind: 'citation',
        ordinal: 1,
        attachmentId: 'att-1',
        page: 2,
        quotedText: 'q',
      },
    ]
    render(<InlineSegments segments={segments} toolLabel={noop} />)
    expect(screen.getByText('[1]')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders an interactive button when onCitationClick is provided', () => {
    const segments: LiveSegment[] = [
      {
        kind: 'citation',
        ordinal: 1,
        attachmentId: 'att-1',
        page: 2,
        quotedText: 'q',
      },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={noop}
        onCitationClick={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Open source 1' }),
    ).toBeInTheDocument()
  })

  it('calls onCitationClick with attachmentId and page when chip is clicked', () => {
    const onCitationClick = vi.fn()
    const segments: LiveSegment[] = [
      {
        kind: 'citation',
        ordinal: 1,
        attachmentId: 'att-42',
        page: 5,
        quotedText: 'text',
      },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={noop}
        onCitationClick={onCitationClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open source 1' }))
    expect(onCitationClick).toHaveBeenCalledWith('att-42', 5)
  })

  it('calls onCitationClick with null page when no page is set', () => {
    const onCitationClick = vi.fn()
    const segments: LiveSegment[] = [
      {
        kind: 'citation',
        ordinal: 1,
        attachmentId: 'att-1',
        page: null,
        quotedText: null,
      },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={noop}
        onCitationClick={onCitationClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open source 1' }))
    expect(onCitationClick).toHaveBeenCalledWith('att-1', null)
  })

  it('renders multiple citation chips with correct ordinals', () => {
    const segments: LiveSegment[] = [
      {
        kind: 'citation',
        ordinal: 1,
        attachmentId: 'att-1',
        page: 1,
        quotedText: 'a',
      },
      {
        kind: 'citation',
        ordinal: 2,
        attachmentId: 'att-2',
        page: 2,
        quotedText: 'b',
      },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={noop}
        onCitationClick={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Open source 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open source 2' }),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// InlineSegments — compose_handoff CTA card
// ---------------------------------------------------------------------------

const validHandoffPayload = {
  channel: 'serve_social' as const,
  draftText: 'Here is a draft social post for you to review.',
  purpose: 'Update constituents on the water bill',
}

describe('InlineSegments — compose_handoff CTA', () => {
  it('renders a CTA card for a valid compose_handoff segment with a callback', () => {
    const segments: LiveSegment[] = [
      {
        kind: 'tool',
        toolName: 'compose_handoff',
        payload: validHandoffPayload,
      },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={noop}
        onComposeHandoff={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Continue in compose' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Social Post')).toBeInTheDocument()
  })

  it('calls onComposeHandoff with the parsed payload when the button is clicked', () => {
    const onComposeHandoff = vi.fn()
    const segments: LiveSegment[] = [
      {
        kind: 'tool',
        toolName: 'compose_handoff',
        payload: validHandoffPayload,
      },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={noop}
        onComposeHandoff={onComposeHandoff}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue in compose' }))
    expect(onComposeHandoff).toHaveBeenCalledWith(validHandoffPayload)
  })

  it('renders a generic tool pill when payload fails schema parse', () => {
    const segments: LiveSegment[] = [
      {
        kind: 'tool',
        toolName: 'compose_handoff',
        payload: { channel: 'unknown_channel', draftText: 'hello' },
      },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={() => 'Compose'}
        onComposeHandoff={vi.fn()}
      />,
    )
    // Falls back to generic pill — no CTA button
    expect(
      screen.queryByRole('button', { name: 'Continue in compose' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Compose')).toBeInTheDocument()
  })

  it('renders a generic tool pill when no onComposeHandoff prop is provided', () => {
    const segments: LiveSegment[] = [
      {
        kind: 'tool',
        toolName: 'compose_handoff',
        payload: validHandoffPayload,
      },
    ]
    render(<InlineSegments segments={segments} toolLabel={() => 'Compose'} />)
    // No callback → falls through to generic pill
    expect(
      screen.queryByRole('button', { name: 'Continue in compose' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Compose')).toBeInTheDocument()
  })

  it('does not affect other tool segments', () => {
    const segments: LiveSegment[] = [
      { kind: 'tool', toolName: 'search_contacts' },
    ]
    render(
      <InlineSegments
        segments={segments}
        toolLabel={() => 'Searching'}
        onComposeHandoff={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Continue in compose' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Searching')).toBeInTheDocument()
  })
})
