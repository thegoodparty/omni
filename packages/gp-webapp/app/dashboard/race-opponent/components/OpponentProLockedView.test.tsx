import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import OpponentProLockedView from './OpponentProLockedView'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/',
}))

const invalidateQueries = vi.fn().mockResolvedValue(undefined)
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<OpponentProLockedView>', () => {
  it('renders the title, subtitle, price, and CTA', () => {
    render(<OpponentProLockedView />)

    expect(
      screen.getByText('Unlock opponent research with Pro'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/See voting records, finance, vulnerabilities/),
    ).toBeInTheDocument()
    expect(screen.getByText('$10')).toBeInTheDocument()
    expect(screen.getByText('/ month')).toBeInTheDocument()
    expect(screen.getByText('7-day free trial')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Upgrade to Pro' }),
    ).toBeInTheDocument()
  })

  it('lists all four Pro benefits', () => {
    render(<OpponentProLockedView />)

    expect(screen.getByText('Deep opponent research')).toBeInTheDocument()
    expect(screen.getByText('Issue-by-issue contrast')).toBeInTheDocument()
    expect(
      screen.getByText('Threat & vulnerability scoring'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ready-to-send messaging')).toBeInTheDocument()
  })

  it('routes into the pro-upgrade flow when Upgrade to Pro is clicked', async () => {
    render(<OpponentProLockedView />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Upgrade to Pro' }),
    )

    expect(push).toHaveBeenCalledWith('/dashboard/pro-upgrade')
  })

  it('re-checks Pro state on Refresh by invalidating the campaign query and re-rendering the route', async () => {
    render(<OpponentProLockedView />)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['campaign'],
      })
    })
    expect(refresh).toHaveBeenCalled()
  })
})
