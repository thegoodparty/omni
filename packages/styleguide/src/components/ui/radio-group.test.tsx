import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadioGroup, RadioCardItem } from './radio-group'

const renderCards = (onValueChange = vi.fn()) => {
  render(
    <RadioGroup value="" onValueChange={onValueChange}>
      <RadioCardItem
        value="in-office"
        id="status-in-office"
        title="I'm an elected official"
        description="I hold an elected office."
      />
      <RadioCardItem
        value="campaigning"
        id="status-campaigning"
        title="I'm still campaigning"
        indicator="check"
      />
    </RadioGroup>,
  )
  return onValueChange
}

describe('RadioCardItem', () => {
  it('selects with one click on its title', async () => {
    const user = userEvent.setup()
    const onValueChange = renderCards()

    await user.click(screen.getByText("I'm an elected official"))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('in-office')
  })

  it('selects with one click on its description', async () => {
    const user = userEvent.setup()
    const onValueChange = renderCards()

    await user.click(screen.getByText('I hold an elected office.'))

    expect(onValueChange).toHaveBeenCalledWith('in-office')
  })

  it('selects with one click on a check card', async () => {
    const user = userEvent.setup()
    const onValueChange = renderCards()

    await user.click(screen.getByText("I'm still campaigning"))

    expect(onValueChange).toHaveBeenCalledWith('campaigning')
  })

  it('is the radio itself, named by its title', () => {
    renderCards()

    const radio = screen.getByRole('radio', {
      name: "I'm an elected official",
    })
    expect(radio).toHaveAccessibleDescription('I hold an elected office.')
    expect(radio).toContainElement(screen.getByText("I'm an elected official"))
  })
})
