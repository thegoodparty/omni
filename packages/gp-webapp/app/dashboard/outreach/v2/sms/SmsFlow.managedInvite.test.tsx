import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import {
  CIVIC_PANEL_JOIN_LINE,
  MANAGED_CIVIC_PANEL_CONSENT_VERSION,
  type ApproveManagedCivicPanelInput,
  type ServeSmsDraftRequest,
} from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { SERVE_SMS_SURFACE, SmsFlow } from './SmsFlow'
import { managedInviteDraft, OPT_OUT_FOOTER } from './smsCompose.util'

vi.mock('app/shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: () => ({ ready: true, enabled: true }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [null, vi.fn()],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-carla', district: {} }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [
    { id: 1, firstName: 'Carla', lastName: 'Diaz' },
    vi.fn(),
    false,
  ],
}))

const DRAFT = managedInviteDraft({
  firstName: 'Carla',
  office: 'Maplewood City Council Member',
})

const messageText = () =>
  screen.getByRole('textbox', { name: 'Message body' }).textContent ?? ''

const open = () => {
  const onSetUp = vi.fn()
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsFlow
      source="deep_link"
      open
      onClose={onClose}
      onScheduled={onScheduled}
      surface={SERVE_SMS_SURFACE}
      initialScript={DRAFT}
      managedInvite={{ place: 'Maplewood', onSetUp }}
    />,
  )
  return { onSetUp, onClose, onScheduled }
}

const submit = () =>
  screen.getByRole('button', { name: 'Set up my civic panel' })

describe('SmsFlow in its managed civic panel invite mode', () => {
  let requests: string[]
  let approvals: ApproveManagedCivicPanelInput[]
  const record = ({ request }: { request: Request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`)
  }

  beforeEach(() => {
    requests = []
    approvals = []
    mswServer.events.on('request:start', record)
    api.mock('POST /v1/contacts/civic-panel/managed', ({ body }) => {
      approvals.push(body)
      return { status: 200, data: { panel: null } }
    })
  })

  afterEach(() => {
    mswServer.events.removeListener('request:start', record)
    vi.clearAllMocks()
  })

  it('opens on the invite alone, with no audience, date or checkout step', async () => {
    open()

    expect(
      (
        await screen.findAllByRole('heading', {
          name: 'Does this invite sound like you?',
        })
      ).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText(
        'It goes to Maplewood residents in your name. We send it and handle every reply.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Civic panel invite')).toBeInTheDocument()
    expect(messageText()).toContain('this is Carla, your Maplewood City')
    expect(screen.queryByText('Who do you want to reach?')).toBeNull()
    expect(screen.queryByText('When do you want to send?')).toBeNull()
    expect(screen.queryByText(/header image/)).toBeNull()
    expect(
      screen.queryByRole('checkbox', {
        name: /Ask them to join your civic panel/,
      }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('keeps the JOIN line and opt-out locked under the editable body', async () => {
    open()
    await screen.findByRole('textbox', { name: 'Message body' })

    expect(screen.getByTestId('managed-invite-locked-lines')).toHaveTextContent(
      `${CIVIC_PANEL_JOIN_LINE} ${OPT_OUT_FOOTER}`,
    )
    expect(messageText()).not.toContain('Reply JOIN')
    expect(messageText()).not.toContain('Reply STOP')
    expect(
      screen.getByRole('button', { name: /Improve with AI/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Dictate message' }),
    ).toBeInTheDocument()
  })

  it('waits for the approval box, then approves the invite as written', async () => {
    const user = userEvent.setup()
    const { onSetUp, onScheduled } = open()
    await screen.findByRole('textbox', { name: 'Message body' })

    expect(submit()).toBeDisabled()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I approve GoodParty sending this invite in my name.',
      }),
    )
    expect(submit()).toBeEnabled()
    await user.click(submit())

    await waitFor(() => expect(onSetUp).toHaveBeenCalledTimes(1))
    expect(approvals).toEqual([
      {
        inviteMessage: `${DRAFT}\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
        consentVersion: MANAGED_CIVIC_PANEL_CONSENT_VERSION,
      },
    ])
    expect(onScheduled).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.CivicPanelInviteSubmitted,
      {
        edited: false,
        usedImproveWithAi: false,
        usedDictation: false,
        inviteSegments: Math.ceil(approvals[0]!.inviteMessage.length / 160),
      },
    )
    // Never an Outreach row, a list, a checkout or a payment.
    expect(requests.filter((request) => request.startsWith('POST'))).toEqual([
      'POST /api/v1/contacts/civic-panel/managed',
    ])
    expect(requests.some((request) => /checkout|payment/.test(request))).toBe(
      false,
    )
  })

  it('polishes the body and keeps the locked lines out of it', async () => {
    const user = userEvent.setup()
    const drafts: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      drafts.push(body)
      return {
        status: 200,
        data: {
          draft: (body.currentDraft ?? '').replace('Want in?', 'Are you in?'),
        },
      }
    })
    open()
    await screen.findByRole('textbox', { name: 'Message body' })

    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

    await waitFor(() => expect(messageText()).toContain('Are you in?'))
    expect(drafts[0]?.currentDraft).toContain(CIVIC_PANEL_JOIN_LINE)
    expect(messageText()).not.toContain('Reply JOIN')
    expect(messageText()).not.toContain('Reply STOP')

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I approve GoodParty sending this invite in my name.',
      }),
    )
    await user.click(submit())
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.CivicPanelInviteSubmitted,
      expect.objectContaining({ edited: true, usedImproveWithAi: true }),
    )
  })

  it('says so when the approval fails, and stays open', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/managed', {
      status: 400,
      data: { message: 'Your invite is missing its join line.' },
    })
    const { onSetUp } = open()
    await screen.findByRole('textbox', { name: 'Message body' })

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I approve GoodParty sending this invite in my name.',
      }),
    )
    await user.click(submit())

    expect(
      await screen.findByText(
        "We couldn't set up your civic panel. Try again.",
      ),
    ).toBeInTheDocument()
    expect(onSetUp).not.toHaveBeenCalled()
  })

  it('leaves through Back without setting anything up', async () => {
    const user = userEvent.setup()
    const { onClose, onSetUp } = open()
    await screen.findByRole('textbox', { name: 'Message body' })

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(onClose).toHaveBeenCalled()
    expect(onSetUp).not.toHaveBeenCalled()
    expect(approvals).toHaveLength(0)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.CivicPanelInviteReviewDismissed,
      { edited: false },
    )
  })
})
