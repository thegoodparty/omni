import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  CIVIC_PANEL_JOIN_LINE,
  type ServeSmsDraftRequest,
} from '@goodparty_org/contracts'
import { useServeCitizenPanelsFlag } from 'app/shared/experiments/serveCitizenPanelsFlag'
import { SERVE_SMS_SURFACE, SmsFlow } from './SmsFlow'
import { OPT_OUT_FOOTER } from './smsCompose.util'

vi.mock('app/shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [null, vi.fn()],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-jane-doe', district: {} }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [
    { id: 1, firstName: 'Jane', lastName: 'Doe' },
    vi.fn(),
    false,
  ],
}))

const JOIN_ASK = 'Reply JOIN to join my civic panel'
const SEED =
  'this is Jane, your Council Member. I am starting a civic panel to hear from all of you.'

const countOf = (text: string, part: string) => text.split(part).length - 1

// Exactly one JOIN line, right above the opt-out, which closes the message
// once: the shape every rewrite must leave behind.
const expectOnePanelLineThenOptOut = (text: string) => {
  expect(countOf(text, JOIN_ASK)).toBe(1)
  expect(countOf(text, OPT_OUT_FOOTER)).toBe(1)
  expect(text.endsWith(`${CIVIC_PANEL_JOIN_LINE}${OPT_OUT_FOOTER}`)).toBe(true)
}

const messageText = () =>
  screen.getByRole('textbox', { name: 'Message body' }).textContent ?? ''

// What gp-api returns for a polish of a panel invite: the whole message, the
// JOIN and STOP lines put back from their markers exactly as they were.
const serverPolish = (currentDraft: string, extra = '') =>
  currentDraft.replace(
    'I am starting a civic panel to hear from all of you.',
    `I want to hear from every one of you.${extra}`,
  )

const openPanelInvite = () =>
  render(
    <SmsFlow
      source="deep_link"
      open
      onClose={vi.fn()}
      onScheduled={vi.fn().mockResolvedValue(undefined)}
      surface={SERVE_SMS_SURFACE}
      preselectedListId={41}
      audienceSettled
      initialPurpose="build_citizens_panel"
      initialAsksToJoinCivicPanel
      initialScript={SEED}
    />,
  )

describe('SmsFlow civic panel lines after a rewrite', () => {
  let draftCalls: ServeSmsDraftRequest[]

  beforeEach(() => {
    draftCalls = []
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 41, name: 'Northside residents' }],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        demographics: { people: 1500, avgAge: null, avgIncome: null },
        reachability: {
          sms: 1200,
          robocall: null,
          phoneBanking: null,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    api.mock('GET /v1/elected-office/current', {
      status: 200,
      data: {
        id: 'eo-1',
        swornInDate: null,
        electedDate: null,
        termStartDate: null,
        termEndDate: null,
        termLengthDays: null,
        isActive: true,
        party: null,
        pledgedAt: null,
        onboardingCompletedAt: null,
        selfReported: true,
        onboardingStep: null,
        campaignId: null,
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens a carried-in invite with one JOIN line and the opt-out', async () => {
    openPanelInvite()
    await screen.findByText(/I am starting a civic panel/)
    expectOnePanelLineThenOptOut(messageText())
  })

  // The reported bug: the polish came back whole, and the flow took the JOIN
  // line for the footer, so it added the ask again and dropped STOP.
  it('keeps one JOIN line and the opt-out through Improve with AI', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return {
        status: 200,
        data: { draft: serverPolish(body.currentDraft ?? '') },
      }
    })
    openPanelInvite()
    await screen.findByText(/I am starting a civic panel/)

    await userEvent.click(
      screen.getByRole('button', { name: /Improve with AI/ }),
    )

    await screen.findByText(/I want to hear from every one of you/)
    expect(draftCalls[0]?.currentDraft).toContain(CIVIC_PANEL_JOIN_LINE)
    expectOnePanelLineThenOptOut(messageText())
  })

  it('drops a JOIN line the model wrote into the body', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => ({
      status: 200,
      data: {
        draft: serverPolish(
          body.currentDraft ?? '',
          ` ${CIVIC_PANEL_JOIN_LINE}`,
        ),
      },
    }))
    openPanelInvite()
    await screen.findByText(/I am starting a civic panel/)

    await userEvent.click(
      screen.getByRole('button', { name: /Improve with AI/ }),
    )

    await screen.findByText(/I want to hear from every one of you/)
    expectOnePanelLineThenOptOut(messageText())
  })

  it('keeps one JOIN line and the opt-out through a tone change, then Undo', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return {
        status: 200,
        data: { draft: serverPolish(body.currentDraft ?? '') },
      }
    })
    openPanelInvite()
    await screen.findByText(/I am starting a civic panel/)

    await userEvent.click(screen.getByRole('radio', { name: /Direct/ }))

    await screen.findByText(/I want to hear from every one of you/)
    expect(draftCalls[0]).toMatchObject({ tone: 'direct' })
    expectOnePanelLineThenOptOut(messageText())

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(messageText()).toMatch(/I am starting a civic panel/),
    )
    expectOnePanelLineThenOptOut(messageText())
  })

  it('keeps one JOIN line and the opt-out on a fresh draft that echoed both', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', () => ({
      status: 200,
      data: {
        draft: `Tell me what matters to you. ${CIVIC_PANEL_JOIN_LINE} ${OPT_OUT_FOOTER}`,
      },
    }))
    render(
      <SmsFlow
        source="deep_link"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        initialPurpose="build_citizens_panel"
      />,
    )
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    await screen.findByText(/Tell me what matters to you/)
    expectOnePanelLineThenOptOut(messageText())
  })
})
