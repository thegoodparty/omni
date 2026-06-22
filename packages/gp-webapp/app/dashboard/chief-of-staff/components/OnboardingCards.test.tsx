import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import OnboardingCards from './OnboardingCards'
import { ONBOARDING_CARDS } from './onboardingCardsConfig'
import type { OnboardingCard } from '../data/contracts'

const cardsRef: { current: OnboardingCard[] | undefined } = {
  current: undefined,
}
const skipMock = vi.fn()

vi.mock('../data/use-dashboard', () => ({
  useOnboardingCards: () => ({ data: cardsRef.current }),
  useSkipOnboardingCard: () => ({ mutate: skipMock, isPending: false }),
}))

beforeEach(() => {
  skipMock.mockReset()
  cardsRef.current = undefined
})

describe('<OnboardingCards>', () => {
  it('renders both cards while active', () => {
    cardsRef.current = [
      { key: 'meet', status: 'active' },
      { key: 'priorities', status: 'active' },
    ]
    render(<OnboardingCards onOpenCard={vi.fn()} />)
    expect(screen.getByText(ONBOARDING_CARDS.meet.title)).toBeInTheDocument()
    expect(
      screen.getByText(ONBOARDING_CARDS.priorities.title),
    ).toBeInTheDocument()
  })

  it('hides a completed or skipped card', () => {
    cardsRef.current = [
      { key: 'meet', status: 'completed' },
      { key: 'priorities', status: 'skipped' },
    ]
    const { container } = render(<OnboardingCards onOpenCard={vi.fn()} />)
    expect(
      screen.queryByText(ONBOARDING_CARDS.meet.title),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(ONBOARDING_CARDS.priorities.title),
    ).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('persists a skip through the mutation', async () => {
    const user = userEvent.setup()
    cardsRef.current = [{ key: 'meet', status: 'active' }]
    render(<OnboardingCards onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /skip/i }))
    expect(skipMock).toHaveBeenCalledWith('meet')
  })

  it('opens the chat for the clicked card via the CTA', async () => {
    const user = userEvent.setup()
    const onOpenCard = vi.fn()
    cardsRef.current = [{ key: 'priorities', status: 'active' }]
    render(<OnboardingCards onOpenCard={onOpenCard} />)
    await user.click(
      screen.getByRole('button', {
        name: ONBOARDING_CARDS.priorities.ctaLabel,
      }),
    )
    expect(onOpenCard).toHaveBeenCalledWith('priorities')
  })
})
