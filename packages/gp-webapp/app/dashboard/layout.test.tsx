import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DashboardLayoutScope from './layout'

vi.mock('@shared/organization-picker', () => ({
  OrganizationScope: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="organization-scope">{children}</div>
  ),
}))

describe('dashboard route group layout', () => {
  // The scope has to be above the page, because pages render DashboardLayout
  // themselves and call org-scoped hooks in their own body (WhatWeHeardPage's
  // useOutreachDetail, for one). Inside DashboardLayout it would leave those
  // page-body reads above the boundary and they would rebuild a departed row's
  // entry under the incoming org — ENG-10991.
  it('renders the page inside the org scope', () => {
    render(
      <DashboardLayoutScope>
        <div>page body</div>
      </DashboardLayoutScope>,
    )

    expect(screen.getByTestId('organization-scope')).toContainElement(
      screen.getByText('page body'),
    )
  })
})
