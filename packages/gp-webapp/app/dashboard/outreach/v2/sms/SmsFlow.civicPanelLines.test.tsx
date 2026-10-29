import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_JOIN_REFUSED_MESSAGE,
  CIVIC_PANEL_LEAVE_LINE,
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

const JOIN_ASK = 'Reply JOIN'
const LEAVE_ASK = 'Reply LEAVE'
const REPLY_LINE = 'Reply YES or NO.'
const SEED = `this is Jane, your Council Member. Should the park stay open later? ${REPLY_LINE}`

const countOf = (text: string, part: string) => text.split(part).length - 1

// No civic panel line, and the opt-out closing the message once: the shape
// every rewrite of a priority's text must leave behind.
const expectNoPanelLineThenOptOut = (text: string) => {
  expect(countOf(text, JOIN_ASK)).toBe(0)
  expect(countOf(text, LEAVE_ASK)).toBe(0)
  expect(countOf(text, OPT_OUT_FOOTER)).toBe(1)
  expect(text.endsWith(OPT_OUT_FOOTER)).toBe(true)
}

const messageText = () =>
  screen.getByRole('textbox', { name: 'Message body' }).textContent ?? ''

// What gp-api returns for a polish: the whole message, the STOP line put
// back from its marker exactly as it was.
const serverPolish = (currentDraft: string, extra = '') =>
  currentDraft.replace(
    'Should the park stay open later?',
    `Should the park stay open past dark?${extra}`,
  )

// A priority card's text, carrying the old JOIN ask the flow no longer adds.
const openPriorityText = () =>
  render(
    <SmsFlow
      source="deep_link"
      open
      onClose={vi.fn()}
      onScheduled={vi.fn().mockResolvedValue(undefined)}
      surface={SERVE_SMS_SURFACE}
      preselectedListId={41}
      audienceSettled
      initialScript={SEED}
      proposalLink={{ priorityId: 'priority-1' }}
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

  it("opens a priority's text with the opt-out directly under its reply line", async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return {
        status: 200,
        data: { draft: serverPolish(body.currentDraft ?? '') },
      }
    })
    openPriorityText()
    await screen.findByText(/Should the park stay open later/)
    expectNoPanelLineThenOptOut(messageText())

    await userEvent.click(
      screen.getByRole('button', { name: /Improve with AI/ }),
    )

    await screen.findByText(/Should the park stay open past dark/)
    expect(draftCalls[0]?.currentDraft).toMatch(
      new RegExp(`later\\? ${REPLY_LINE}\\n${OPT_OUT_FOOTER}$`),
    )
    expectNoPanelLineThenOptOut(messageText())
  })

  it('drops a JOIN or LEAVE line the model wrote into the body', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => ({
      status: 200,
      data: {
        draft: serverPolish(
          body.currentDraft ?? '',
          ` ${CIVIC_PANEL_JOIN_LINE} ${CIVIC_PANEL_LEAVE_LINE}`,
        ),
      },
    }))
    openPriorityText()
    await screen.findByText(/Should the park stay open later/)

    await userEvent.click(
      screen.getByRole('button', { name: /Improve with AI/ }),
    )

    await screen.findByText(/Should the park stay open past dark/)
    expectNoPanelLineThenOptOut(messageText())
  })

  it('keeps the opt-out under the reply line through a tone change, then Undo', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return {
        status: 200,
        data: { draft: serverPolish(body.currentDraft ?? '') },
      }
    })
    openPriorityText()
    await screen.findByText(/Should the park stay open later/)

    await userEvent.click(screen.getByRole('radio', { name: /Direct/ }))

    await screen.findByText(/Should the park stay open past dark/)
    expect(draftCalls[0]).toMatchObject({ tone: 'direct' })
    expectNoPanelLineThenOptOut(messageText())

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(messageText()).toMatch(/Should the park stay open later/),
    )
    expectNoPanelLineThenOptOut(messageText())
  })

  // Outside a priority the opt-out keeps its own paragraph, and a fresh
  // draft that echoed the panel ask and the opt-out keeps neither copy.
  it('drops the echoed JOIN line on a fresh draft from the Outreach tab', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return {
        status: 200,
        data: {
          draft: `Tell me what matters to you. ${CIVIC_PANEL_JOIN_LINE} ${OPT_OUT_FOOTER}`,
        },
      }
    })
    render(
      <SmsFlow
        source="deep_link"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        initialPurpose="explain_decision"
      />,
    )
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    await screen.findByText(/Tell me what matters to you/)
    expectNoPanelLineThenOptOut(messageText())
  })

  // gp-api refuses the create; the composer says why, in its words, first.
  it('refuses a pasted JOIN line with the server words', async () => {
    const user = userEvent.setup()
    openPriorityText()
    await screen.findByText(/Should the park stay open later/)
    expect(screen.queryByText(CIVIC_PANEL_JOIN_REFUSED_MESSAGE)).toBeNull()

    const box = screen.getByRole('textbox', { name: 'Message body' })
    const { editor } = box as HTMLElement & { editor: Editor }
    act(() => {
      editor.commands.insertContentAt(1, `${CIVIC_PANEL_JOIN_LINE} `)
    })

    expect(
      await screen.findByText(CIVIC_PANEL_JOIN_REFUSED_MESSAGE),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(
      screen.getByRole('textbox', { name: 'Message body' }),
    ).toBeInTheDocument()
  })
})
