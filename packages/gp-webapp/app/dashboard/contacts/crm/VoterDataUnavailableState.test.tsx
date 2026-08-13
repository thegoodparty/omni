import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import VoterDataUnavailableState from './VoterDataUnavailableState'

describe('VoterDataUnavailableState', () => {
  it('names the office when one is known', () => {
    render(
      <VoterDataUnavailableState
        officeName="Detroit Public Schools Community District Board"
        isWinContext
      />,
    )

    expect(
      screen.getByText(/Detroit Public Schools Community District Board/),
    ).toBeInTheDocument()
  })

  it('falls back to generic copy with no office name', () => {
    render(<VoterDataUnavailableState officeName={null} isWinContext />)

    expect(
      screen.getByText(/match your office to a district/),
    ).toBeInTheDocument()
  })

  it('uses Win copy and never says constituent', () => {
    render(<VoterDataUnavailableState officeName="Mayor" isWinContext />)

    expect(screen.getByText(/voter file/)).toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('uses Serve copy when not Win', () => {
    render(
      <VoterDataUnavailableState officeName="Mayor" isWinContext={false} />,
    )

    expect(screen.getByText(/constituent file/)).toBeInTheDocument()
  })

  it('links to support with the office prefilled', () => {
    render(<VoterDataUnavailableState officeName="Mayor" isWinContext />)

    const href = screen
      .getByRole('link', { name: /contact support/i })
      .getAttribute('href')

    expect(href).toContain('mailto:help@goodparty.org')
    expect(href).toContain('Mayor')
  })

  it('omits the office from the subject when it is unknown', () => {
    render(<VoterDataUnavailableState officeName={null} isWinContext />)

    const href = screen
      .getByRole('link', { name: /contact support/i })
      .getAttribute('href')

    expect(href).toContain('mailto:help@goodparty.org')
    expect(href).not.toContain('undefined')
    expect(href).not.toContain('null')
  })
})
