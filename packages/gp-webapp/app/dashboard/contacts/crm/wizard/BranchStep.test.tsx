import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import BranchStep from './BranchStep'

// ENG-10721: BranchStep's card copy names voters/constituents and must never
// cross over (app/dashboard/contacts/CLAUDE.md) — Win must never see
// "constituent"/"constituent file", Serve must never see "voter"/"voter file".
describe('BranchStep — Win-vs-Serve card copy never crosses over', () => {
  it('reads voter-file wording for Win', () => {
    render(
      <BranchStep selected={null} onSelect={vi.fn()} isWinContext={true} />,
    )

    expect(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('reads constituent-file wording for Serve', () => {
    render(
      <BranchStep selected={null} onSelect={vi.fn()} isWinContext={false} />,
    )

    expect(
      screen.getByRole('radio', {
        name: /build my list using the constituent file/i,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/\bvoter/i)).not.toBeInTheDocument()
  })
})
