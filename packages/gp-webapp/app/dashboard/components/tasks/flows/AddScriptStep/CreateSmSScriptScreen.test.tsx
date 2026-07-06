import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { CreateSmSScriptScreen } from './CreateSmSScriptScreen'

describe('CreateSmSScriptScreen', () => {
  it('starts with an empty script when no initialScriptText is given', () => {
    render(<CreateSmSScriptScreen />)

    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('seeds the script from initialScriptText and counts it against the limit', () => {
    render(<CreateSmSScriptScreen initialScriptText="Hello voters" />)

    expect(screen.getByRole('textbox')).toHaveValue('Hello voters')
    expect(screen.getByText('12 / 1600')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('calls onNext with the edited value, not the seeded one', () => {
    const onNext = vi.fn()
    render(
      <CreateSmSScriptScreen
        initialScriptText="Hello voters"
        onNext={onNext}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Hello voters, vote Tuesday!' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onNext).toHaveBeenCalledWith('Hello voters, vote Tuesday!')
  })

  it('disables Next when the seeded text is edited past the 1600 limit', () => {
    render(<CreateSmSScriptScreen initialScriptText="Hi" />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'x'.repeat(1601) },
    })

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
