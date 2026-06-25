import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

// Taps go through user.pointer with a touch pointer (not user.click, which
// simulates a mouse and hover-opens the tooltip before the click lands):
// touch is the case openOnClick exists for, and it exercises the full
// pointerdown → click sequence including Radix's own close-on-click handler
// that TooltipTrigger has to suppress.
const tap = (user: ReturnType<typeof userEvent.setup>, target: Element) =>
  user.pointer({ keys: '[TouchA]', target })

describe('Tooltip', () => {
  it('opens on trigger tap when openOnClick is set', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip openOnClick>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    expect(screen.queryByText('Plan details')).not.toBeInTheDocument()

    await tap(user, screen.getByText('Campaign plan'))

    const contents = await screen.findAllByText('Plan details')
    expect(contents.length).toBeGreaterThan(0)
  })

  it('closes a tap-opened tooltip on a second trigger tap', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip openOnClick>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    await tap(user, screen.getByText('Campaign plan'))
    await screen.findAllByText('Plan details')

    await tap(user, screen.getByText('Campaign plan'))

    await waitFor(() =>
      expect(screen.queryByText('Plan details')).not.toBeInTheDocument(),
    )
  })

  it('closes a tap-opened tooltip on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip openOnClick>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    await tap(user, screen.getByText('Campaign plan'))
    await screen.findAllByText('Plan details')

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByText('Plan details')).not.toBeInTheDocument(),
    )
  })

  it('keyboard: focus opens, Enter toggles closed and open again', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip openOnClick>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    // Radix opens on keyboard focus by itself.
    await user.tab()
    await screen.findAllByText('Plan details')

    // Enter fires a click with no preceding pointerdown — the toggle branch.
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(screen.queryByText('Plan details')).not.toBeInTheDocument(),
    )

    await user.keyboard('{Enter}')
    const contents = await screen.findAllByText('Plan details')
    expect(contents.length).toBeGreaterThan(0)
  })

  it('closes an open tooltip when a sibling trigger is tapped', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Tooltip openOnClick>
          <TooltipTrigger>Label A</TooltipTrigger>
          <TooltipContent>Content A</TooltipContent>
        </Tooltip>
        <Tooltip openOnClick>
          <TooltipTrigger>Label B</TooltipTrigger>
          <TooltipContent>Content B</TooltipContent>
        </Tooltip>
      </div>,
    )

    await tap(user, screen.getByText('Label A'))
    await screen.findAllByText('Content A')

    // The tap on B is a pointerdown outside A's dismissable layer, so Radix
    // closes A — click-opened tooltips never stack.
    await tap(user, screen.getByText('Label B'))
    await screen.findAllByText('Content B')

    expect(screen.queryByText('Content A')).not.toBeInTheDocument()
  })

  it('does not open on tap without openOnClick', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    await tap(user, screen.getByText('Campaign plan'))

    expect(screen.queryByText('Plan details')).not.toBeInTheDocument()
  })
})
