import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GeneratedUiSpec } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { GENUI_FIXTURES } from 'app/dev/genui-json-render/fixtures'
import { GeneratedUi } from './GeneratedUi'

const fixture = (name: string): GeneratedUiSpec => {
  const found = GENUI_FIXTURES.find((entry) => entry.name.startsWith(name))
  if (!found) throw new Error(`no fixture ${name}`)
  return found.spec
}

describe('GeneratedUi', () => {
  it('renders the dashboard stats and table from the spec', () => {
    render(<GeneratedUi spec={fixture('District')} onSendMessage={vi.fn()} />)
    expect(screen.getByText('Ward 3 at a glance')).toBeInTheDocument()
    expect(screen.getByText('18,240')).toBeInTheDocument()
    expect(
      screen.getByRole('cell', { name: 'Library hours' }),
    ).toBeInTheDocument()
  })

  it('submits the picks bound in state through the submit_choices action', async () => {
    const onSendMessage = vi.fn()
    render(
      <GeneratedUi spec={fixture('Choice')} onSendMessage={onSendMessage} />,
    )
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Door knocking' }),
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Text' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSendMessage).toHaveBeenCalledWith('Text and Door knocking')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('sends a user turn from the contact, outreach and next-step buttons', async () => {
    const onSendMessage = vi.fn()
    const { unmount } = render(
      <GeneratedUi spec={fixture('Contact')} onSendMessage={onSendMessage} />,
    )
    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute(
      'href',
      'tel:5550142',
    )
    await userEvent.click(
      screen.getByRole('button', { name: /Ask about them/ }),
    )
    expect(onSendMessage).toHaveBeenLastCalledWith(
      'Tell me more about Jane Rivera.',
    )
    unmount()

    render(
      <GeneratedUi spec={fixture('Outreach')} onSendMessage={onSendMessage} />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Set up the text' }),
    )
    expect(onSendMessage).toHaveBeenLastCalledWith(
      "Let's set up the text outreach",
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Draft a social post too' }),
    )
    expect(onSendMessage).toHaveBeenLastCalledWith(
      'Draft a social post about the new library hours.',
    )
  })
})
