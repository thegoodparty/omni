import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from './textarea'

// jsdom never lays out, so scrollHeight is always 0 and autoGrow's
// "not laid out yet" guard would skip every resize. Shadow scrollHeight on the
// prototype so the sizing math runs the way a real browser drives it.
let scrollHeight = 0

// The component reads exactly these five properties, so a plain stand-in is
// enough and keeps the expected sizes readable.
const stubComputedStyle = (
  overrides: Partial<Record<string, string>> = {},
): void => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    lineHeight: '20px',
    paddingTop: '8px',
    paddingBottom: '8px',
    borderTopWidth: '1px',
    borderBottomWidth: '1px',
    ...overrides,
  } as unknown as CSSStyleDeclaration)
}

beforeEach(() => {
  scrollHeight = 0
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
})

afterEach(() => {
  Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight')
  vi.restoreAllMocks()
})

describe('Textarea', () => {
  it('keeps the fixed min height and sets no inline height without autoGrow', () => {
    scrollHeight = 200
    render(<Textarea aria-label="Message" />)
    const el = screen.getByLabelText('Message')
    expect(el).toHaveClass('min-h-16')
    expect(el.style.height).toBe('')
  })

  it('drops the fixed min height and disables manual resize with autoGrow', () => {
    render(<Textarea aria-label="Message" autoGrow />)
    const el = screen.getByLabelText('Message')
    expect(el).toHaveClass('min-h-0', 'resize-none')
    expect(el).not.toHaveClass('min-h-16')
  })

  it('sizes to the content, adding the borders scrollHeight omits', () => {
    stubComputedStyle()
    scrollHeight = 76
    render(
      <Textarea
        aria-label="Message"
        autoGrow
        value="three lines"
        onChange={vi.fn()}
      />,
    )
    const el = screen.getByLabelText('Message')
    // 76 content+padding, plus 1px top and bottom border under border-box.
    expect(el.style.height).toBe('78px')
    expect(el.style.overflowY).toBe('hidden')
  })

  it('caps at maxRows and switches to scrolling past it', () => {
    stubComputedStyle()
    scrollHeight = 216
    render(
      <Textarea
        aria-label="Message"
        autoGrow
        maxRows={6}
        value="lots of lines"
        onChange={vi.fn()}
      />,
    )
    const el = screen.getByLabelText('Message')
    // 6 rows * 20px line height + 16px padding + 2px border.
    expect(el.style.height).toBe('138px')
    expect(el.style.overflowY).toBe('auto')
  })

  it('stays capped exactly at the maxRows boundary without scrolling', () => {
    stubComputedStyle()
    scrollHeight = 136
    render(
      <Textarea
        aria-label="Message"
        autoGrow
        maxRows={6}
        value="exactly six lines"
        onChange={vi.fn()}
      />,
    )
    const el = screen.getByLabelText('Message')
    expect(el.style.height).toBe('138px')
    expect(el.style.overflowY).toBe('hidden')
  })

  it('falls back to a 20px line height when computed styles are empty', () => {
    // jsdom's real getComputedStyle returns '' for these, which would otherwise
    // make the cap NaN and silently drop the assignment.
    scrollHeight = 500
    render(
      <Textarea
        aria-label="Message"
        autoGrow
        maxRows={3}
        value="lots"
        onChange={vi.fn()}
      />,
    )
    const el = screen.getByLabelText('Message')
    expect(el.style.height).toBe('60px')
    expect(el.style.overflowY).toBe('auto')
  })

  it('shrinks back to one row when the value is cleared after a send', () => {
    stubComputedStyle()
    scrollHeight = 76
    const { rerender } = render(
      <Textarea
        aria-label="Message"
        autoGrow
        value="a long draft"
        onChange={vi.fn()}
      />,
    )
    const el = screen.getByLabelText('Message')
    expect(el.style.height).toBe('78px')

    // The composer clears itself after a send — a value change with no input
    // event, which is why the resize is driven by an effect on `value`.
    scrollHeight = 36
    rerender(
      <Textarea aria-label="Message" autoGrow value="" onChange={vi.fn()} />,
    )
    expect(el.style.height).toBe('38px')
    expect(el.style.overflowY).toBe('hidden')
  })

  it('resizes uncontrolled callers on raw input', async () => {
    const user = userEvent.setup()
    stubComputedStyle()
    render(<Textarea aria-label="Message" autoGrow defaultValue="" />)
    const el = screen.getByLabelText('Message')

    scrollHeight = 56
    await user.type(el, 'typed')
    expect(el.style.height).toBe('58px')
  })

  it('still calls a caller-supplied onInput', async () => {
    const user = userEvent.setup()
    const onInput = vi.fn()
    stubComputedStyle()
    render(<Textarea aria-label="Message" autoGrow onInput={onInput} />)

    await user.type(screen.getByLabelText('Message'), 'hi')
    expect(onInput).toHaveBeenCalled()
  })

  it('leaves the height alone when the element has not been laid out', () => {
    stubComputedStyle()
    scrollHeight = 0
    render(
      <Textarea aria-label="Message" autoGrow value="x" onChange={vi.fn()} />,
    )
    // Collapsed for measurement, then left as-is rather than pinned to 0px.
    expect(screen.getByLabelText('Message').style.height).toBe('auto')
  })
})
