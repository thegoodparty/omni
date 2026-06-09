import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

describe('Tooltip', () => {
  it('opens on trigger click when openOnClick is set', async () => {
    render(
      <Tooltip openOnClick>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    expect(screen.queryByText('Plan details')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Campaign plan'))

    const contents = await screen.findAllByText('Plan details')
    expect(contents.length).toBeGreaterThan(0)
  })

  it('closes a click-opened tooltip on Escape', async () => {
    render(
      <Tooltip openOnClick>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    fireEvent.click(screen.getByText('Campaign plan'))
    await screen.findAllByText('Plan details')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByText('Plan details')).not.toBeInTheDocument(),
    )
  })

  it('does not open on click without openOnClick', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Campaign plan</TooltipTrigger>
        <TooltipContent>Plan details</TooltipContent>
      </Tooltip>,
    )

    fireEvent.click(screen.getByText('Campaign plan'))

    expect(screen.queryByText('Plan details')).not.toBeInTheDocument()
  })
})
