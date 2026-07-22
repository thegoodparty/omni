import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { P2pUxEnabledContext } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'
import OutreachCreateCards from './OutreachCreateCards'
import type { Campaign } from 'helpers/types'

vi.mock('app/dashboard/components/tasks/flows/TaskFlow', () => ({
  default: ({
    type,
    preselectedListId,
    onClose,
  }: {
    type: string
    preselectedListId?: number
    onClose: () => void
  }) => (
    <div
      data-testid="task-flow"
      data-type={type}
      data-preselected-list-id={preselectedListId ?? ''}
    >
      <button onClick={onClose}>close</button>
    </div>
  ),
}))

const renderCards = ({
  preselectedListId,
}: {
  preselectedListId?: number
} = {}) =>
  render(
    <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
      <P2pUxEnabledContext.Provider
        value={{
          p2pUxEnabled: true,
          tcrCompliant: false,
          proUpdatedAtDate: new Date(),
          resetP2pUxEnabled: () => undefined,
        }}
      >
        <OutreachCreateCards preselectedListId={preselectedListId} />
      </P2pUxEnabledContext.Provider>
    </CampaignContext.Provider>,
  )

// ENG-10762 (Bugbot follow-up): the deep-linked preselectedListId must apply
// to only the first flow the user opens after arrival, then clear — so a
// later-opened flow (any card, not just text) starts clean instead of
// inheriting a stale preselect.
describe('OutreachCreateCards — ENG-10762 consume-once preselectedListId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('threads preselectedListId into the first flow opened, then clears it once that flow closes', async () => {
    const user = userEvent.setup()
    renderCards({ preselectedListId: 42 })

    await user.click(screen.getByText('Door knocking'))

    const firstFlow = await screen.findByTestId('task-flow')
    expect(firstFlow).toHaveAttribute('data-preselected-list-id', '42')

    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()

    await user.click(screen.getByText('Door knocking'))
    const secondFlow = await screen.findByTestId('task-flow')
    expect(secondFlow).toHaveAttribute('data-preselected-list-id', '')
  })

  it('renders with no preselected list id when the prop is never provided', async () => {
    const user = userEvent.setup()
    renderCards()

    await user.click(screen.getByText('Door knocking'))

    const flow = await screen.findByTestId('task-flow')
    expect(flow).toHaveAttribute('data-preselected-list-id', '')
  })

  it('keeps the captured id across a re-render where the prop reverts to undefined (the listId-strip RSC refresh)', async () => {
    const user = userEvent.setup()
    const { rerender } = renderCards({ preselectedListId: 42 })

    rerender(
      <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
        <P2pUxEnabledContext.Provider
          value={{
            p2pUxEnabled: true,
            tcrCompliant: false,
            proUpdatedAtDate: new Date(),
            resetP2pUxEnabled: () => undefined,
          }}
        >
          <OutreachCreateCards preselectedListId={undefined} />
        </P2pUxEnabledContext.Provider>
      </CampaignContext.Provider>,
    )

    await user.click(screen.getByText('Door knocking'))
    const flow = await screen.findByTestId('task-flow')
    expect(flow).toHaveAttribute('data-preselected-list-id', '42')
  })

  it('updates the captured id when a different defined id arrives before a flow opens', async () => {
    const user = userEvent.setup()
    const { rerender } = renderCards({ preselectedListId: 42 })

    rerender(
      <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
        <P2pUxEnabledContext.Provider
          value={{
            p2pUxEnabled: true,
            tcrCompliant: false,
            proUpdatedAtDate: new Date(),
            resetP2pUxEnabled: () => undefined,
          }}
        >
          <OutreachCreateCards preselectedListId={99} />
        </P2pUxEnabledContext.Provider>
      </CampaignContext.Provider>,
    )

    await user.click(screen.getByText('Door knocking'))
    const flow = await screen.findByTestId('task-flow')
    expect(flow).toHaveAttribute('data-preselected-list-id', '99')
  })
})
