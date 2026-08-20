import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { TCR_COMPLIANCE_QUERY_KEY } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import {
  type ComposeFlowType,
  useOutreachComposeFlow,
} from './useOutreachComposeFlow'

vi.mock('app/dashboard/components/tasks/flows/TaskFlow', () => ({
  default: ({
    type,
    campaignPlanDueDate,
  }: {
    type: string
    campaignPlanDueDate?: string
  }) => (
    <div
      data-testid="task-flow"
      data-type={type}
      data-due-date={campaignPlanDueDate ?? ''}
    />
  ),
}))

vi.mock(
  'app/dashboard/profile/texting-compliance/util/tcrCompliance.util',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('app/dashboard/profile/texting-compliance/util/tcrCompliance.util')
      >()
    return {
      ...actual,
      getTcrCompliance: vi
        .fn()
        .mockResolvedValue({ status: actual.TCR_COMPLIANCE_STATUS.APPROVED }),
    }
  },
)

const Harness = ({
  type,
  due,
}: {
  type: ComposeFlowType
  due?: string | null
}): React.JSX.Element => {
  const { open, flowNode } = useOutreachComposeFlow('campaign_tracker')
  return (
    <>
      <button type="button" onClick={() => open(type, due)}>
        launch
      </button>
      {flowNode}
    </>
  )
}

const renderHarness = (
  { isPro }: { isPro: boolean },
  props: { type: ComposeFlowType; due?: string | null },
) =>
  render(
    <CampaignContext.Provider value={[{ id: 1, isPro } as Campaign]}>
      <Harness {...props} />
    </CampaignContext.Provider>,
  )

describe('useOutreachComposeFlow', () => {
  it('opens the robocall flow with the sliced due date for a Pro user', async () => {
    renderHarness(
      { isPro: true },
      { type: 'robocall', due: '2026-02-03T00:00:00.000Z' },
    )
    fireEvent.click(screen.getByRole('button', { name: 'launch' }))

    const flow = await screen.findByTestId('task-flow')
    expect(flow).toHaveAttribute('data-type', 'robocall')
    expect(flow).toHaveAttribute('data-due-date', '2026-02-03')
  })

  it('shows the Pro upgrade modal instead of the flow for a non-Pro robocall', async () => {
    renderHarness({ isPro: false }, { type: 'robocall' })
    fireEvent.click(screen.getByRole('button', { name: 'launch' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('routes text through the text gate: non-Pro sees the P2P modal, no flow', async () => {
    renderHarness({ isPro: false }, { type: 'text', due: '2026-02-03' })
    fireEvent.click(screen.getByRole('button', { name: 'launch' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('opens the text flow for a compliant Pro user with the due date', async () => {
    // The gate treats an unresolved compliance query as not-yet-compliant, so
    // seed the cache: this test is about the compliant-Pro pass, not the race.
    testQueryClient.setQueryData(TCR_COMPLIANCE_QUERY_KEY, {
      status: 'approved',
    })
    renderHarness({ isPro: true }, { type: 'text', due: '2026-02-03' })
    fireEvent.click(screen.getByRole('button', { name: 'launch' }))

    const flow = await screen.findByTestId('task-flow')
    expect(flow).toHaveAttribute('data-type', 'text')
    expect(flow).toHaveAttribute('data-due-date', '2026-02-03')
  })
})
