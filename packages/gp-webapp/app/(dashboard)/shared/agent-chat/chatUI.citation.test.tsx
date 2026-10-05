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
