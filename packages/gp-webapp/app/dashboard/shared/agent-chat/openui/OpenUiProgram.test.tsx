import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { OpenUiProgram } from './OpenUiProgram'

const renderProgram = (lines: string[]) => {
  const onMessage = vi.fn()
  render(<OpenUiProgram program={lines.join('\n')} onMessage={onMessage} />)
  return onMessage
}

describe('OpenUiProgram', () => {
  it('renders the catalog components from an openui-lang program', () => {
    renderProgram([
      'root = Stack([title, stats, table])',
      'title = Heading("At a glance")',
      'stats = Stack([s1], "horizontal")',
      's1 = Stat("Residents", 48200, "+3%")',
      'table = Table(["Issue", "Share"], [["Housing", "34%"]])',
    ])
    expect(screen.getByText('At a glance')).toBeInTheDocument()
    expect(screen.getByText('48200')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Share' })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'Housing' })).toBeVisible()
  })

  it('sends a multi-select answer as one user turn, in option order', async () => {
    const onMessage = renderProgram([
      'root = Stack([q])',
      'q = ChoiceQuestion("Which channels?", ["Texts", "Calls", "Doors"], true)',
    ])
    await userEvent.click(screen.getByLabelText('Doors'))
    await userEvent.click(screen.getByLabelText('Texts'))
    await userEvent.click(screen.getByRole('button', { name: 'Use these' }))
    expect(onMessage).toHaveBeenCalledWith('Texts and Doors')
    expect(screen.queryByRole('button', { name: 'Use these' })).toBeNull()
  })

  it('turns @ToAssistant, the contact card and @StartOutreach into user turns', async () => {
    const onMessage = renderProgram([
      'root = Stack([card, ask, outreach])',
      'card = ContactCard("Jane Rivera", "City Clerk", null, "555-0142")',
      'ask = ActionButton("Summarize", @ToAssistant("Summarize my week"))',
      'outreach = OutreachCard("text", "Seniors", 1200, "Library hours changed")',
    ])
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute(
      'href',
      'tel:5550142',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Ask about them' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Start the text' }),
    )
    expect(onMessage.mock.calls).toEqual([
      ['How can Jane Rivera, our City Clerk, help my office?'],
      ['Summarize my week'],
      ["Let's set up the text outreach"],
    ])
  })
})
