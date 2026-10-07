import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardNavHeaderAction from './DashboardNavHeaderAction'

// The reparenting and mobile-visibility behavior is covered against the real
// layout in DashboardLayout.test.tsx (that is where the wiring lives). This file
// covers the no-layout case on its own, because it's what lets the four owning
// components be unit-tested without a DashboardLayout around them.
describe('DashboardNavHeaderAction with no bar to portal into', () => {
  it('renders the action in place', () => {
    render(
      <div data-testid="page-body">
        <DashboardNavHeaderAction>
          <button>Save</button>
        </DashboardNavHeaderAction>
      </div>,
    )

    expect(screen.getByTestId('page-body')).toContainElement(
      screen.getByRole('button', { name: 'Save' }),
    )
  })
})
