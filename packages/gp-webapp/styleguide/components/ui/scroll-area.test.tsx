import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ScrollArea } from './scroll-area'

describe('ScrollArea', () => {
  it('renders viewport and root slots', () => {
    const { container } = render(
      <ScrollArea>
        <div>content</div>
      </ScrollArea>,
    )
    expect(
      container.querySelector('[data-slot="scroll-area"]'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="scroll-area-viewport"]'),
    ).toBeInTheDocument()
  })

  it('renders a vertical scrollbar by default', () => {
    const { container } = render(
      <ScrollArea type="always">
        <div>content</div>
      </ScrollArea>,
    )
    const scrollbar = container.querySelector(
      '[data-slot="scroll-area-scrollbar"]',
    )
    expect(scrollbar).toBeInTheDocument()
    expect(scrollbar).toHaveAttribute('data-orientation', 'vertical')
  })

  it('renders a horizontal scrollbar when orientation="horizontal"', () => {
    const { container } = render(
      <ScrollArea type="always" orientation="horizontal">
        <div>content</div>
      </ScrollArea>,
    )
    const scrollbar = container.querySelector(
      '[data-slot="scroll-area-scrollbar"]',
    )
    expect(scrollbar).toBeInTheDocument()
    expect(scrollbar).toHaveAttribute('data-orientation', 'horizontal')
  })

  it('renders both scrollbars when orientation="both"', () => {
    const { container } = render(
      <ScrollArea type="always" orientation="both">
        <div>content</div>
      </ScrollArea>,
    )
    const scrollbars = container.querySelectorAll(
      '[data-slot="scroll-area-scrollbar"]',
    )
    expect(scrollbars).toHaveLength(2)
    const orientations = Array.from(scrollbars).map((el) =>
      el.getAttribute('data-orientation'),
    )
    expect(orientations).toContain('vertical')
    expect(orientations).toContain('horizontal')
  })

  it('scrollbar is a sibling of viewport, not a descendant', () => {
    const { container } = render(
      <ScrollArea type="always">
        <div>content</div>
      </ScrollArea>,
    )
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    )
    const scrollbar = container.querySelector(
      '[data-slot="scroll-area-scrollbar"]',
    )
    expect(viewport?.contains(scrollbar)).toBe(false)
    expect(viewport?.parentElement).toBe(scrollbar?.parentElement)
  })

  it('forwards className to root', () => {
    const { container } = render(
      <ScrollArea className="test-class">
        <div>content</div>
      </ScrollArea>,
    )
    expect(container.querySelector('[data-slot="scroll-area"]')).toHaveClass(
      'test-class',
    )
  })
})
