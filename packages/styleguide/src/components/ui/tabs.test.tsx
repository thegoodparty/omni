import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

const Fixture = ({
  defaultValue = 'a',
  disabledC = false,
  listRef,
}: {
  defaultValue?: string
  disabledC?: boolean
  listRef?: React.Ref<HTMLDivElement>
}) => (
  <Tabs defaultValue={defaultValue}>
    <TabsList ref={listRef}>
      <TabsTrigger value="a">A</TabsTrigger>
      <TabsTrigger value="b">B</TabsTrigger>
      <TabsTrigger value="c" disabled={disabledC}>
        C
      </TabsTrigger>
    </TabsList>
    <TabsContent value="a">Panel A</TabsContent>
    <TabsContent value="b">Panel B</TabsContent>
    <TabsContent value="c">Panel C</TabsContent>
  </Tabs>
)

// jsdom has no layout, so the scroll-into-view branches are driven by mocking
// the list's overflow metrics and the rects of the list / active trigger.
const rect = (left: number, right: number): DOMRect =>
  ({
    left,
    right,
    width: right - left,
    top: 0,
    bottom: 40,
    height: 40,
    x: left,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect

const mockRect = (el: Element, left: number, right: number) =>
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(left, right))

const setOverflow = (
  list: HTMLElement,
  scrollWidth: number,
  clientWidth: number,
) => {
  Object.defineProperty(list, 'scrollWidth', {
    configurable: true,
    value: scrollWidth,
  })
  Object.defineProperty(list, 'clientWidth', {
    configurable: true,
    value: clientWidth,
  })
}

const tab = (name: string) => screen.getByRole('tab', { name })

describe('Tabs', () => {
  it('activates a tab and reveals its panel on click', async () => {
    const user = userEvent.setup()
    render(<Fixture defaultValue="a" />)
    expect(screen.getByText('Panel A')).toBeInTheDocument()

    await user.click(tab('B'))

    expect(tab('B')).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Panel B')).toBeInTheDocument()
    expect(screen.queryByText('Panel A')).not.toBeInTheDocument()
  })

  it('does not activate a disabled trigger', () => {
    render(<Fixture defaultValue="a" disabledC />)
    fireEvent.click(tab('C'))
    expect(tab('A')).toHaveAttribute('data-state', 'active')
    expect(screen.queryByText('Panel C')).not.toBeInTheDocument()
  })

  it('forwards a ref to the list', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Fixture listRef={ref} />)
    expect(ref.current).toBe(screen.getByRole('tablist'))
    expect(ref.current).toHaveAttribute('data-slot', 'tabs-list')
  })

  describe('scroll active trigger into view', () => {
    it('does not scroll when the triggers fit', async () => {
      const user = userEvent.setup()
      render(<Fixture defaultValue="a" />)
      const list = screen.getByRole('tablist')
      setOverflow(list, 100, 100)
      const scrollBy = vi.fn()
      list.scrollBy = scrollBy

      await user.click(tab('C'))
      await waitFor(() =>
        expect(tab('C')).toHaveAttribute('data-state', 'active'),
      )

      expect(scrollBy).not.toHaveBeenCalled()
    })

    it('scrolls right when the active trigger clips the trailing edge', async () => {
      const user = userEvent.setup()
      render(<Fixture defaultValue="b" />)
      const list = screen.getByRole('tablist')
      setOverflow(list, 300, 100)
      const scrollBy = vi.fn()
      list.scrollBy = scrollBy
      mockRect(list, 0, 100)
      mockRect(tab('C'), 110, 190)

      await user.click(tab('C'))
      await waitFor(() => expect(scrollBy).toHaveBeenCalled())

      expect(scrollBy.mock.lastCall?.[0].left).toBeGreaterThan(0)
    })

    it('scrolls left when the active trigger clips the leading edge', async () => {
      const user = userEvent.setup()
      render(<Fixture defaultValue="b" />)
      const list = screen.getByRole('tablist')
      setOverflow(list, 300, 100)
      const scrollBy = vi.fn()
      list.scrollBy = scrollBy
      mockRect(list, 0, 100)
      mockRect(tab('A'), -50, 20)

      await user.click(tab('A'))
      await waitFor(() => expect(scrollBy).toHaveBeenCalled())

      expect(scrollBy.mock.lastCall?.[0].left).toBeLessThan(0)
    })
  })
})
