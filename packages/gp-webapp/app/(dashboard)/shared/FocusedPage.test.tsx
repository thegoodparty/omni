import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { router } from 'helpers/test-utils/router-mocking'
import { FocusedPage } from './FocusedPage'
import DashboardNavHeaderAction from './DashboardNavHeaderAction'

describe('FocusedPage', () => {
  it('titles the page and leaves it with Back', async () => {
    render(
      <FocusedPage title="Your race">
        <p>office details</p>
      </FocusedPage>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your race' }),
    ).toBeInTheDocument()
    expect(screen.getByText('office details')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    // jsdom starts with a one-entry history, so Back falls through to the
    // Game Plan, where these pages are opened from.
    expect(router.push).toHaveBeenCalledWith('/campaign-plan')
  })

  it('puts a page action beside the title', () => {
    render(
      <FocusedPage title="Your opponents">
        <DashboardNavHeaderAction>
          <button type="button">Export brief</button>
        </DashboardNavHeaderAction>
      </FocusedPage>,
    )

    const header = screen.getByRole('banner')
    expect(
      within(header).getByRole('button', { name: 'Export brief' }),
    ).toBeInTheDocument()
  })
})
