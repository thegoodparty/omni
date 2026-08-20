import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import OutreachCreateCards from './OutreachCreateCards'
import type { Campaign } from 'helpers/types'

vi.mock('app/dashboard/outreach/hooks/useTextOutreachGate', () => ({
  useTextOutreachGate: () => ({ runTextGate: () => true, gateModals: null }),
}))

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
      <OutreachCreateCards preselectedListId={preselectedListId} />
    </CampaignContext.Provider>,
  )

// ENG-10762 (Bugbot follow-up): the deep-linked preselectedListId is
// consume-once, but only flows whose audience step actually applies it
// (text, robocall as of ENG-10764, and phone banking as of ENG-10765) clear
// it on close — it survives a non-consuming flow's close (door knocking).
describe('OutreachCreateCards — ENG-10762 consume-once preselectedListId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('threads preselectedListId into the first flow opened, then clears it once a text flow closes', async () => {
    const user = userEvent.setup()
    renderCards({ preselectedListId: 42 })

    await user.click(screen.getByText('Text message'))

    const firstFlow = await screen.findByTestId('task-flow')
    expect(firstFlow).toHaveAttribute('data-preselected-list-id', '42')

    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()

    await user.click(screen.getByText('Text message'))
    const secondFlow = await screen.findByTestId('task-flow')
    expect(secondFlow).toHaveAttribute('data-preselected-list-id', '')
  })

  it('keeps the pending id when a non-consuming flow closes, so the text flow still preselects', async () => {
    const user = userEvent.setup()
    renderCards({ preselectedListId: 42 })

    // Door knocking's audience step never applies preselectedListId, so
    // closing it must not burn the pending id (unlike text/robocall below).
    await user.click(screen.getByText('Door knocking'))
    await screen.findByTestId('task-flow')
    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()

    await user.click(screen.getByText('Text message'))
    const textFlow = await screen.findByTestId('task-flow')
    expect(textFlow).toHaveAttribute('data-preselected-list-id', '42')
  })

  it('clears the pending id once a robocall flow closes (ENG-10764)', async () => {
    const user = userEvent.setup()
    renderCards({ preselectedListId: 42 })

    await user.click(screen.getByText('Robocall'))
    const firstFlow = await screen.findByTestId('task-flow')
    expect(firstFlow).toHaveAttribute('data-preselected-list-id', '42')

    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()

    await user.click(screen.getByText('Robocall'))
    const secondFlow = await screen.findByTestId('task-flow')
    expect(secondFlow).toHaveAttribute('data-preselected-list-id', '')
  })

  it('clears the pending id once a phone banking flow closes (ENG-10765)', async () => {
    const user = userEvent.setup()
    renderCards({ preselectedListId: 42 })

    await user.click(screen.getByText('Phone banking'))
    const firstFlow = await screen.findByTestId('task-flow')
    expect(firstFlow).toHaveAttribute('data-preselected-list-id', '42')

    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()

    await user.click(screen.getByText('Phone banking'))
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
        <OutreachCreateCards preselectedListId={undefined} />
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
        <OutreachCreateCards preselectedListId={99} />
      </CampaignContext.Provider>,
    )

    await user.click(screen.getByText('Door knocking'))
    const flow = await screen.findByTestId('task-flow')
    expect(flow).toHaveAttribute('data-preselected-list-id', '99')
  })
})
