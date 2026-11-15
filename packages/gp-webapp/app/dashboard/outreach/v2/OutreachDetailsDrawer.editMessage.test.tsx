import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSnackbar } from 'helpers/useSnackbar'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import type { HistoryRow } from './historyStatus.util'

const flag = vi.hoisted(() => ({ enabled: true }))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
}))
vi.mock('app/shared/experiments/winSmsPreviewEditFlag', () => ({
  useWinSmsPreviewEditFlag: () => ({ ready: true, enabled: flag.enabled }),
}))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ phone: '5551234567' }, vi.fn(), false],
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const SCRIPT =
  'Hello {first_name}, this is Sam. Paid for by Sam for Mayor. Reply STOP to opt out.'

const SAVED_SCRIPT = `${SCRIPT} See you Saturday.`

const row: HistoryRow = {
  id: 41,
  createdAt: '2026-08-20T00:00:00Z',
  outreachType: 'p2p',
  name: 'Likely voters',
  status: 'pending',
  phoneListId: 9,
  script: SCRIPT,
}

const detail = {
  id: 41,
  createdAt: new Date('2026-08-10T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
  campaignId: 1,
  outreachType: 'p2p' as const,
  projectId: null,
  name: 'Likely voters',
  status: 'pending' as const,
  error: null,
  audienceRequest: null,
  script: SCRIPT,
  message: null,
  date: null,
  imageUrl: 'https://assets.example.org/img.png',
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
  archivedAt: null,
}

const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()

beforeEach(() => {
  flag.enabled = true
  vi.mocked(trackEvent).mockClear()
  successSnackbar.mockClear()
  errorSnackbar.mockClear()
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar,
    successSnackbar,
  })
  api.mock('GET /v1/outreach/:id/receipt', {
    status: 404,
    data: { message: 'No receipt' },
  })
})

describe('OutreachDetailsDrawer — edit message', () => {
  it('shows Edit message on an unlocked row', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...detail, isLockedForEdit: false },
    })
    render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)
    expect(
      await screen.findByRole('button', { name: 'Edit message' }),
    ).toBeInTheDocument()
  })

  it('hides Edit and says the text is queued once it is locked', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...detail, isLockedForEdit: true },
    })
    render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)
    expect(
      await screen.findByText(
        "Your text is queued for sending, so it can't be edited.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit message' }),
    ).not.toBeInTheDocument()
  })

  it('keeps Send a test on a locked row', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...detail, isLockedForEdit: true },
    })
    render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)
    expect(
      await screen.findByRole('button', { name: 'Send a test' }),
    ).toBeInTheDocument()
  })

  it('hides Edit with the flag off', async () => {
    flag.enabled = false
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...detail, isLockedForEdit: false },
    })
    render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)
    expect(
      await screen.findByRole('button', { name: 'Cancel campaign' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit message' }),
    ).not.toBeInTheDocument()
  })

  it('walks compose and preview, then saves the script', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...detail, isLockedForEdit: false },
    })
    let patched: unknown
    api.mock('PATCH /v1/outreach/:id/sms/script', ({ params, body }) => {
      patched = { id: params.id, body }
      return {
        status: 200,
        data: { ...detail, script: SAVED_SCRIPT, isLockedForEdit: false },
      }
    })
    render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit message' }),
    )
    await screen.findByRole('textbox', { name: 'Message body' })
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save message' }),
    )

    await waitFor(() => expect(successSnackbar).toHaveBeenCalled())
    expect(await screen.findByText(SAVED_SCRIPT)).toBeInTheDocument()
    expect(patched).toEqual({ id: '41', body: { script: SCRIPT } })
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.SmsMessageUpdated, {
      product: 'win',
      lengthBefore: SCRIPT.length,
      lengthAfter: SCRIPT.length,
    })
  })

  it('blocks Continue and Save and says why when the Paid for by line is removed', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...detail, isLockedForEdit: false },
    })
    render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit message' }),
    )
    const body = await screen.findByRole('textbox', { name: 'Message body' })
    const { editor } = body as HTMLElement & { editor: Editor }
    act(() => {
      editor.commands.setContent(
        'Hello {first_name}, this is Sam. Reply STOP to opt out.',
      )
    })

    expect(
      await screen.findByText('Keep the "Paid for by" line in your message.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('switches to the locked state when the save answers 409', async () => {
    api.mockOrdered('GET /v1/outreach/:id', [
      { status: 200, data: { ...detail, isLockedForEdit: false } },
      { status: 200, data: { ...detail, isLockedForEdit: true } },
    ])
    api.mock('PATCH /v1/outreach/:id/sms/script', {
      status: 409,
      data: { message: 'already queued' },
    })
    render(<OutreachDetailsDrawer row={row} onOpenChange={vi.fn()} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit message' }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save message' }),
    )

    expect(
      await screen.findByText(
        "Your text is queued for sending, so it can't be edited.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit message' }),
    ).not.toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Outreach.SmsMessageUpdated,
      expect.anything(),
    )
  })
})
