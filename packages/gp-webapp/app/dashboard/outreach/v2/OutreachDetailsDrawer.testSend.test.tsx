import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import type { HistoryRow } from './historyStatus.util'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ phone: '5551234567' }, vi.fn(), false],
}))

const flagRef = vi.hoisted(() => ({ enabled: true }))
vi.mock('app/shared/experiments/winSmsPreviewEditFlag', () => ({
  useWinSmsPreviewEditFlag: () => ({ ready: true, enabled: flagRef.enabled }),
}))

const row = (status: HistoryRow['status']): HistoryRow => ({
  id: 41,
  createdAt: '2026-08-20T00:00:00Z',
  outreachType: 'p2p',
  name: 'Likely voters — SMS',
  status,
  phoneListId: 9,
})

const mockDetail = (status: 'pending' | 'canceled') => {
  api.mock('GET /v1/outreach/:id/receipt', {
    status: 404,
    data: { message: 'No receipt' },
  })
  api.mock('GET /v1/outreach/:id', {
    status: 200,
    data: {
      id: 41,
      createdAt: new Date('2026-08-20T00:00:00Z'),
      updatedAt: new Date('2026-08-20T00:00:00Z'),
      campaignId: 1,
      outreachType: 'p2p' as const,
      projectId: 'proj-1',
      name: 'Likely voters — SMS',
      error: null,
      audienceRequest: null,
      script: null,
      message: null,
      date: null,
      imageUrl: null,
      voterFileFilterId: null,
      doorKnockingRouteId: null,
      phoneListId: 9,
      identityId: null,
      didState: null,
      didNpaSubset: [],
      title: null,
      textCount: null,
      billableTextCount: null,
      campaignPlanDueDate: null,
      organizationSlug: null,
      status,
      archivedAt: null,
    },
  })
}

beforeEach(() => {
  flagRef.enabled = true
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  })
})

describe('OutreachDetailsDrawer send a test', () => {
  it('offers a test text on a scheduled text campaign', async () => {
    mockDetail('pending')
    render(
      <OutreachDetailsDrawer row={row('pending')} onOpenChange={vi.fn()} />,
    )
    expect(
      await screen.findByRole('button', { name: 'Send a test' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Phone number 1')).toHaveValue('5551234567')
  })

  it('starts the form fresh when the drawer switches to another row', async () => {
    const user = userEvent.setup()
    mockDetail('pending')
    const { rerender } = render(
      <OutreachDetailsDrawer row={row('pending')} onOpenChange={vi.fn()} />,
    )
    const field = await screen.findByLabelText('Phone number 1')
    await user.type(field, '9')
    await user.click(screen.getByRole('button', { name: 'Add a number' }))
    expect(screen.getAllByLabelText(/Phone number/)).toHaveLength(2)

    rerender(
      <OutreachDetailsDrawer
        row={{ ...row('pending'), id: 42 }}
        onOpenChange={vi.fn()}
      />,
    )
    expect(await screen.findByLabelText('Phone number 1')).toHaveValue(
      '5551234567',
    )
    expect(screen.getAllByLabelText(/Phone number/)).toHaveLength(1)
  })

  it('hides the test form for a canceled campaign', async () => {
    mockDetail('canceled')
    render(
      <OutreachDetailsDrawer row={row('canceled')} onOpenChange={vi.fn()} />,
    )
    expect(
      await screen.findByRole('button', { name: 'Move to archive' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send a test' }),
    ).not.toBeInTheDocument()
  })

  it('hides the test form when the flag is off', async () => {
    flagRef.enabled = false
    mockDetail('pending')
    render(
      <OutreachDetailsDrawer row={row('pending')} onOpenChange={vi.fn()} />,
    )
    expect(
      await screen.findByRole('button', { name: 'Cancel campaign' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send a test' }),
    ).not.toBeInTheDocument()
  })
})
