import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SourceAttribution from './SourceAttribution'

describe('SourceAttribution', () => {
  it('renders an external anchor for the given source url', () => {
    render(
      <SourceAttribution
        sourceUrl="https://ballotpedia.org/example"
        sourceType="Ballotpedia"
        label="Candidate profile"
      />,
    )
    const link = screen.getByRole('link', { name: /Candidate profile/ })
    expect(link).toHaveAttribute('href', 'https://ballotpedia.org/example')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders the source-type label', () => {
    render(
      <SourceAttribution
        sourceUrl="https://example.com"
        sourceType="Opponent website"
        label="Issues page"
      />,
    )
    expect(screen.getByText('Opponent website:')).toBeInTheDocument()
  })
})
