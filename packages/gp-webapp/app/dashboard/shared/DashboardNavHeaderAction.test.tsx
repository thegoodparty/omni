import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import DashboardNavHeader from './DashboardNavHeader'
import DashboardNavHeaderAction, {
  NavHeaderActionSlotContext,
} from './DashboardNavHeaderAction'

vi.mock('@styleguide', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))
vi.mock('@styleguide/components/ui/icons', () => ({
  SparklesIcon: () => null,
  ClipboardListIcon: () => null,
  FlagIcon: () => null,
  ScrollTextIcon: () => null,
  SendIcon: () => null,
  UsersRoundIcon: () => null,
  SwordsIcon: () => null,
  LayoutDashboardIcon: () => null,
  BookOpenIcon: () => null,
  CircleUserRoundIcon: () => null,
}))

// Mirrors how DashboardLayout wires the two together: the bar hands back its
// CTA slot element through a ref callback, that lands in state, and the state
// becomes the context value the body renders under.
const Harness = ({ withHeader = true }: { withHeader?: boolean }) => {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return (
    <>
      {withHeader && (
        <DashboardNavHeader
          icon="book"
          label="Your story"
          hasAction
          actionSlotRef={setSlot}
        />
      )}
      <NavHeaderActionSlotContext.Provider value={slot}>
        <div data-testid="page-body">
          <DashboardNavHeaderAction>
            <button>Save</button>
          </DashboardNavHeaderAction>
        </div>
      </NavHeaderActionSlotContext.Provider>
    </>
  )
}

describe('DashboardNavHeaderAction', () => {
  it('lands the CTA inside the title bar, not in the page body', async () => {
    render(<Harness />)

    // The slot element only exists after the bar's ref callback has run, so the
    // first render necessarily falls back to rendering in place — what matters
    // is that the state update reparents it before the user sees it.
    await waitFor(() => {
      const slot = document.querySelector('[data-slot="nav-header-action"]')
      expect(slot).not.toBeNull()
      expect(slot).toContainElement(
        screen.getByRole('button', { name: 'Save' }),
      )
    })
    expect(screen.getByTestId('page-body')).not.toContainElement(
      screen.getByRole('button', { name: 'Save' }),
    )
  })

  it('renders the CTA in place when there is no bar to portal into', () => {
    render(<Harness withHeader={false} />)

    expect(screen.getByTestId('page-body')).toContainElement(
      screen.getByRole('button', { name: 'Save' }),
    )
  })
})
