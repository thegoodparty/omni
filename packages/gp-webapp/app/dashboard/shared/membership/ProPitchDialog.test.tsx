import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { ProPitchDialog } from './ProPitchDialog'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProPitchDialog', () => {
  it('renders the title, the price pill and every tile title when open', () => {
    render(<ProPitchDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText(MEMBERSHIP_COPY.pitch.title)).toBeInTheDocument()
    expect(screen.getByText(MEMBERSHIP_COPY.pitch.pill)).toBeInTheDocument()
    MEMBERSHIP_COPY.pitch.tiles.forEach(({ title, body }) => {
      expect(screen.getByText(title)).toBeInTheDocument()
      expect(screen.getByText(body)).toBeInTheDocument()
    })
  })

  it('fires PitchViewed when the dialog opens', () => {
    render(<ProPitchDialog open onOpenChange={vi.fn()} />)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.PitchViewed,
    )
  })

  it('renders nothing when closed', () => {
    render(<ProPitchDialog open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByText(MEMBERSHIP_COPY.pitch.title)).toBeNull()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('pushes the Pro upgrade entry path and closes when Join is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ProPitchDialog open onOpenChange={onOpenChange} />)

    await user.click(
      screen.getByRole('button', { name: MEMBERSHIP_COPY.pitch.join }),
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.PitchJoin,
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(router.push).toHaveBeenCalledWith('/dashboard/pro-upgrade')
  })

  it('closes without navigating when the dialog is dismissed', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ProPitchDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Membership.PitchDismiss,
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(router.push).not.toHaveBeenCalled()
  })
})
