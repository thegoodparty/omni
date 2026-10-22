import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { ServeSmsDraftRequest } from '@goodparty_org/contracts'
import {
  checkSmsStandards,
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_LEAVE_LINE,
} from '@goodparty_org/contracts'
import { useServeCitizenPanelsFlag } from 'app/shared/experiments/serveCitizenPanelsFlag'
import { SERVE_SMS_SURFACE, SmsFlow } from './SmsFlow'
import {
  OPT_OUT_FOOTER,
  SERVE_SMS_GREETING,
  SMS_GREETING_PREVIEW,
  SERVE_SMS_SAMPLE_FIRST_NAME,
  SMS_GREETING,
  withSampleFirstName,
} from './smsCompose.util'

const deleteLine = (editor: Editor, line: string) => {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text?.indexOf(line) ?? -1) : -1
    if (from === -1 && index !== -1) from = pos + index
  })
  act(() => {
    editor.view.dispatch(editor.state.tr.delete(from, from + line.length))
  })
}

vi.mock('app/shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    status: 'idle' as const,
    error: null,
    partialTranscript: '',
    active: false,
    busy: false,
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
  }),
}))

// Untyped clientFetch path, so module-mocked rather than MSW-mocked. Serve
// has no Peerly phone list of its own yet — replacing this derivation with
// the org-scoped create is the hub-wiring ticket's job, not the surface's.
vi.mock('helpers/createP2pPhoneList', () => ({
  createP2pPhoneList: vi.fn(async () => ({
    ok: true,
    token: 'tok-1',
    buildId: 'build-1',
  })),
  getP2pPhoneListBuildStatus: vi.fn(async () => ({
    buildStatus: 'ready',
    phoneListId: 77,
    leadsLoaded: 1200,
    excludedOptedOutCount: 0,
    excludedDuplicatePhoneCount: 0,
  })),
}))

// An elected official has no campaign row at all — that is the whole reason
// the Serve surface exists.
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

// Tuesday, so the first bookable day (+3 => Friday the 4th) stays inside the
// month and its day number addresses exactly one calendar cell.
const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

let recommendedListsRequested = false

const openServeFlow = () => {
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsFlow
      source="outreach_page"
      open
      onClose={onClose}
      onScheduled={onScheduled}
      surface={SERVE_SMS_SURFACE}
    />,
  )
  return { onClose, onScheduled }
}

describe('SmsFlow (Serve surface)', () => {
  beforeEach(() => {
    recommendedListsRequested = false
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: false,
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
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
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    // Answered so an accidental request is visible as a flipped flag rather
    // than an MSW unhandled-request warning.
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      recommendedListsRequested = true
      return { status: 200, data: [] }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers the serve purpose cards, not the win ones', async () => {
    openServeFlow()

    expect(
      await screen.findByText('Explain a recent decision'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ask for community input')).toBeInTheDocument()
    expect(screen.getByText('Share a resource or service')).toBeInTheDocument()
    // Win's electoral slugs have no serve counterpart.
    expect(screen.queryByText(/Get out the vote|Early voting/i)).toBeNull()
    expect(
      screen.getByText(
        'This helps us draft the right message for your constituents.',
      ),
    ).toBeInTheDocument()
  })

  it('never asks for recommended lists, even on a slug Win also uses', async () => {
    const draftCalls: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted body' } }
    })
    openServeFlow()

    // introduce_myself is one of the three slugs shared with Win, so a
    // purpose-string check would have mapped it to a Win intent and fired
    // the campaign-scoped endpoint against an eo- org.
    await userEvent.click(
      await screen.findByText('Introduce myself to constituents'),
    )
    await screen.findByText(
      'Select a list or create a new one. Lists include all constituents with a mobile number.',
    )

    expect(recommendedListsRequested).toBe(false)
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  it('frames the audience step for constituents', async () => {
    openServeFlow()
    await userEvent.click(
      await screen.findByText('Introduce myself to constituents'),
    )

    expect(
      await screen.findByText(
        'Select a list or create a new one. Lists include all constituents with a mobile number.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/all voters with a mobile number/)).toBeNull()
  })

  it('drafts against the serve endpoint, then schedules by date only at a fixed 11am', async () => {
    const draftCalls: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted body' } }
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    // The message comes before the date: drafted on compose first.
    await waitFor(() => expect(draftCalls).toHaveLength(1))
    expect(draftCalls[0]).toMatchObject({
      purpose: 'explain_decision',
      tone: 'warm',
    })
    await screen.findByText(/drafted body/)
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'.repeat(100)], 'header.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The serve step: the promise is stated, never picked.
    expect(
      await screen.findByText(/All messages are sent at 11am local time\./),
    ).toBeInTheDocument()
    expect(screen.queryByText('Send time')).toBeNull()
    expect(screen.queryByText(/48 hours/)).toBeNull()

    // Friday the 4th — the first day the borrowed polls predicate leaves open.
    await userEvent.click(
      screen.getByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    )
    expect(
      await screen.findByText(/Estimated completion: Wed, Sep 9, 2026\./),
    ).toBeInTheDocument()
  })

  it('keeps the name in step with the send date, even after an edit', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await screen.findByText(/drafted body/)
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'.repeat(100)], 'header.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const nameField = await screen.findByLabelText('Campaign name')
    expect(nameField).toHaveValue('Northside residents')

    await userEvent.click(
      screen.getByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    )
    expect(nameField).toHaveValue('Northside residents, Sep 4')

    await userEvent.clear(nameField)
    await userEvent.type(nameField, 'Northside budget, Sep 4')
    await userEvent.click(
      screen.getByRole('button', { name: /^Monday, September 7(?!\d)/ }),
    )
    expect(nameField).toHaveValue('Northside budget, Sep 7')

    // The calendar sits flush left under the name field, not centered.
    const calendarColumn = screen.getByRole('grid').closest('.items-start')
    expect(calendarColumn).not.toBeNull()
    expect(calendarColumn).not.toHaveClass('items-center')
  })

  // Staff need 3 business days to set up a priority's two-round text, so
  // its calendar opens a day later than any other Serve text's.
  it('closes days within 3 business days for a two-round priority text', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    render(
      <SmsFlow
        source="outreach_page"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        roundTwoSize={1_000}
      />,
    )

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await screen.findByText(/drafted body/)
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'.repeat(100)], 'header.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText(/All messages are sent at 11am local time\./)

    expect(
      screen.getByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /^Monday, September 7(?!\d)/ }),
    ).toBeEnabled()
  })

  it('keeps the opt-out footer and appends no paid-for-by line', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(await screen.findByText(OPT_OUT_FOOTER)).toBeInTheDocument()
    expect(screen.queryByText(/Paid for by/)).toBeNull()
  })

  const composeWithDraft = async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await screen.findByText(OPT_OUT_FOOTER)
  }

  it('offers no civic panel ask with serve-citizen-panels off', async () => {
    await composeWithDraft()

    expect(
      screen.queryByRole('checkbox', { name: /join your civic panel/i }),
    ).toBeNull()
    expect(screen.queryByText(/Reply JOIN/)).toBeNull()
  })

  it('adds the JOIN line when the civic panel ask is checked', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    await composeWithDraft()

    const ask = screen.getByRole('checkbox', {
      name: /join your civic panel/i,
    })
    expect(ask).not.toBeChecked()
    expect(screen.queryByText(/Reply JOIN/)).toBeNull()

    await userEvent.click(ask)

    expect(
      await screen.findByText(/Reply JOIN to join my civic panel/),
    ).toBeInTheDocument()
    expect(ask).toBeChecked()
  })

  // A priority card that asks the panel and new residents in one send opens
  // with the ask on. The seed is signed with the official's name after the
  // flow opens, and that pass must not drop the ask.
  it("keeps a chat card's civic panel ask through the seed's signing", async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    render(
      <SmsFlow
        source="deep_link"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        initialScript="Has flooding damaged your home?"
        initialAsksToJoinCivicPanel
        preselectedListId={41}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(
      await screen.findByText(/Reply JOIN to join my civic panel/),
    ).toBeInTheDocument()
    const ask = screen.getByRole('checkbox', {
      name: /join your civic panel/i,
    })
    expect(ask).toBeChecked()
    // Not a panel-building text, so the official can still take it off.
    expect(ask).not.toBeDisabled()
  })

  // A text to the civic panel alone offers members a way off it, in place of
  // the JOIN ask: required like the JOIN line, and never beside it.
  const panelOnlyLists = () =>
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [
        { id: 41, name: 'Northside residents' },
        { id: 42, name: 'Panel not asked lately', civicPanelMember: true },
      ],
    })

  it('offers LEAVE on a text to panel members alone, and offers it back once deleted', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    panelOnlyLists()
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Panel not asked lately'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(
      await screen.findByText(/Reply LEAVE to leave my civic panel\./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Reply JOIN/)).toBeNull()
    expect(
      screen.queryByRole('checkbox', { name: /join your civic panel/i }),
    ).toBeNull()

    const box = screen.getByRole('textbox', { name: 'Message body' })
    const editor = (box as HTMLElement & { editor: Editor }).editor
    deleteLine(editor, CIVIC_PANEL_LEAVE_LINE)
    expect(
      await screen.findByText(
        /Your text needs the line for leaving your civic panel\./,
      ),
    ).toBeInTheDocument()
    expect(editor.getText()).not.toContain('Reply LEAVE')

    await userEvent.click(
      screen.getByRole('button', { name: 'Add the civic panel line back' }),
    )
    await waitFor(() =>
      expect(editor.getText()).toContain(CIVIC_PANEL_LEAVE_LINE),
    )
    expect(
      screen.queryByText(/Your text needs the line for leaving/),
    ).toBeNull()
  })

  it("swaps a card's JOIN ask for LEAVE when its list is the panel alone", async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    panelOnlyLists()
    render(
      <SmsFlow
        source="deep_link"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        initialScript="Has flooding damaged your home?"
        initialAsksToJoinCivicPanel
        preselectedListId={42}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(
      await screen.findByText(/Reply LEAVE to leave my civic panel\./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Reply JOIN/)).toBeNull()
  })

  it('offers no LEAVE line with serve-citizen-panels off', async () => {
    panelOnlyLists()
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Panel not asked lately'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(await screen.findByText(OPT_OUT_FOOTER)).toBeInTheDocument()
    expect(screen.queryByText(/Reply LEAVE/)).toBeNull()
  })

  // A report back goes to the people already asked: with the panel on, it
  // still never carries the join line or offers the box.
  it('keeps the join ask off a report back, whatever the card asked', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    render(
      <SmsFlow
        source="deep_link"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        initialPurpose="report_back"
        initialScript="Thanks for answering. Most of you named the drains."
        initialAsksToJoinCivicPanel
        preselectedListId={41}
        reportBackForOutreachId={77}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(
      await screen.findByText(/Most of you named the drains/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Reply JOIN/)).toBeNull()
    expect(
      screen.queryByRole('checkbox', { name: /join your civic panel/i }),
    ).toBeNull()
  })

  it('never offers reporting back in the purpose picker', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    openServeFlow()
    await screen.findByText('Explain a recent decision')
    expect(screen.queryByText('Report back to the people you asked')).toBeNull()
  })

  it('hides building a civic panel with serve-citizen-panels off', async () => {
    openServeFlow()
    await screen.findByText('Explain a recent decision')
    expect(screen.queryByText('Build your civic panel')).toBeNull()
  })

  it('lists building a civic panel first with serve-citizen-panels on', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    openServeFlow()

    expect(
      await screen.findByText('Build your civic panel'),
    ).toBeInTheDocument()
  })

  // The card already answered the purpose, and a panel text is its ask, so
  // the box is ticked and cannot be unticked.
  it('opens on the civic panel purpose with the JOIN ask ticked for good', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    const draftCalls: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted body' } }
    })
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
    expect(screen.queryByText('Explain a recent decision')).toBeNull()
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(
      await screen.findByText(/Reply JOIN to join my civic panel/),
    ).toBeInTheDocument()
    expect(draftCalls[0]).toMatchObject({ purpose: 'build_citizens_panel' })
    const ask = screen.getByRole('checkbox', {
      name: /join your civic panel/i,
    })
    expect(ask).toBeChecked()
    expect(ask).toBeDisabled()

    // The line itself is editable: deleting it says what the text needs.
    const box = screen.getByRole('textbox', { name: 'Message body' })
    const editor = (box as HTMLElement & { editor: Editor }).editor
    deleteLine(editor, CIVIC_PANEL_JOIN_LINE)
    expect(
      await screen.findByText(/Your text needs its civic panel ask\./),
    ).toBeInTheDocument()
  })

  // The Chief of Staff's invite card carries its own words and the build
  // purpose. The words are kept, not drafted over, and the send is still the
  // build purpose's: the ask locked on and the purpose on the draft.
  it("keeps a card's invite on the civic panel purpose, the JOIN ask locked on", async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    const draftCalls: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted body' } }
    })
    render(
      <SmsFlow
        source="deep_link"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        initialPurpose="build_citizens_panel"
        initialAsksToJoinCivicPanel
        initialScript="this is Jane, your Council Member. I am starting a civic panel to hear from all of you."
      />,
    )

    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(
      await screen.findByText(/I am starting a civic panel/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Reply JOIN to join my civic panel/),
    ).toBeInTheDocument()
    const ask = screen.getByRole('checkbox', {
      name: /join your civic panel/i,
    })
    expect(ask).toBeChecked()
    expect(ask).toBeDisabled()
    expect(draftCalls).toHaveLength(0)
  })

  // A chat card that saved its list opens the standard flow on the message,
  // with the purpose and the list already done behind it.
  it("opens a card's flow on the message with every step in the stepper", async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
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
        initialScript="this is Jane, your Council Member. I am starting a civic panel to hear from all of you."
      />,
    )

    expect(
      await screen.findByText(/I am starting a civic panel/),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 3 of 5',
    )
    expect(screen.queryByTestId('proposal-audience-summary')).toBeNull()
    expect(screen.queryByText('Change who gets this')).toBeNull()

    // Back walks the standard flow: the card's list, picked, then its purpose.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Northside residents')).toBeInTheDocument()
    expect(
      await screen.findByText(/Message 1,200 constituents/),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 2 of 5',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      await screen.findByRole('button', { name: /Build your civic panel/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 1 of 5',
    )
  })

  // A civic panel plan's text step settles the purpose and its frozen list,
  // so the flow opens on the message with the invite drafting, and Back
  // still walks to the list and the purpose.
  it("opens a plan step's text on the message, drafting the invite", async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    const draftCalls: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted body' } }
    })
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
      />,
    )

    expect(
      await screen.findByText(/Reply JOIN to join my civic panel/),
    ).toBeInTheDocument()
    expect(draftCalls[0]).toMatchObject({ purpose: 'build_citizens_panel' })
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 3 of 5',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Northside residents')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 2 of 5',
    )
  })

  it("goes on from a card's message to the date, and back to the message", async () => {
    render(
      <SmsFlow
        source="deep_link"
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        surface={SERVE_SMS_SURFACE}
        preselectedListId={41}
        audienceSettled
        initialScript="this is Jane, your Council Member. The library opens Saturday."
      />,
    )

    expect(
      await screen.findByText(/The library opens Saturday/),
    ).toBeInTheDocument()
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'.repeat(100)], 'header.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      (await screen.findAllByText('When do you want to send?')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 4 of 5',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      await screen.findByRole('textbox', { name: 'Message body' }),
    ).toBeInTheDocument()
  })

  // A tile open walks the same order a card does: the message before the date.
  it('walks a tile open purpose, audience, message, date, review, and back', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()
    const step = (n: number) =>
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuetext',
        `Step ${n} of 5`,
      )

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    step(2)
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    await screen.findByText(/drafted body/)
    expect(screen.getByRole('textbox', { name: 'Message body' })).toBeVisible()
    step(3)
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'.repeat(100)], 'header.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      (await screen.findAllByText('When do you want to send?')).length,
    ).toBeGreaterThan(0)
    step(4)
    await userEvent.click(
      screen.getByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findAllByText('Review & pay')).length).toBeGreaterThan(
      0,
    )
    step(5)

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      (await screen.findAllByText('When do you want to send?')).length,
    ).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      await screen.findByRole('textbox', { name: 'Message body' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Northside residents')).toBeInTheDocument()
  })

  // Reached without a card's list (the hub's panel link), Back from the list
  // goes to the purpose picker like any flow.
  it('goes back to the purpose picker from a purpose a link answered', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
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

    await screen.findByText('Choose a constituent list')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      await screen.findByRole('button', { name: /Build your civic panel/ }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  // "Campaign" is Win vocabulary: an elected official has an office and a
  // term. This string lives on the shared compose step, which the
  // per-surface records cannot reach, so it keys on the surface's own
  // isServe flag rather than being renamed for everyone.
  it('asks for a header image, not a campaign headshot', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    expect(await screen.findByText('Add your header image')).toBeInTheDocument()
    expect(screen.queryByText(/campaign headshot/i)).not.toBeInTheDocument()
  })

  // The chip used to read "Greeting First Name", which names a variable
  // rather than showing the words a constituent reads. It now shows the
  // greeting with a stand-in name, and the caption says the name changes.
  it('shows the greeting as it will read, with a stand-in first name', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Message body' }),
      ).toHaveTextContent(/^Hello First name,/),
    )
    expect(screen.queryByText(SMS_GREETING_PREVIEW.caption)).toBeNull()
    expect(screen.queryByText('Greeting First Name')).toBeNull()
    expect(screen.queryByText(/\{\{first_name\}\}/)).toBeNull()
  })

  // The image makes the text an MMS, which is what lets it run past one
  // SMS segment, so Serve asks for one before going on, as Win does. Continue
  // stays pressable and a press says what is missing, next to the image.
  it('asks for the header image when Continue is pressed without one', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    await screen.findByText(/drafted body/)
    const next = screen.getByRole('button', { name: 'Continue' })
    expect(next).toBeEnabled()
    expect(screen.queryByText('Add a header image to continue.')).toBeNull()

    await userEvent.click(next)
    expect(
      await screen.findByText('Add a header image to continue.'),
    ).toBeInTheDocument()
    const dropzone = screen.getByRole('button', {
      name: /Add your header image/,
    })
    expect(dropzone).toHaveFocus()
    expect(dropzone).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'Message body' })).toBeVisible()

    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'.repeat(100)], 'header.png', { type: 'image/png' }),
    )
    await waitFor(() =>
      expect(screen.queryByText('Add a header image to continue.')).toBeNull(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(
      await screen.findByRole('button', {
        name: /^Friday, September 4(?!\d)/,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findAllByText('Review & pay')).length).toBeGreaterThan(
      0,
    )
  })
})

// Unit-level guards on the surface itself, so the seam is pinned even where
// driving the whole flow would not reach it.
describe('SERVE_SMS_SURFACE', () => {
  it('composes the opt-out footer alone, whatever committee it is handed', () => {
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'Council voted to repave Oak St.',
      'Friends of Jane',
    )
    expect(composed).toContain(OPT_OUT_FOOTER)
    expect(composed).not.toContain('Paid for by')
  })

  // Peerly merges the single-brace token; the Slack fulfilment path Serve
  // rides merges the double-brace one, the same form polls converts its
  // authored [Name] into. Emitting Win's token here would text a constituent
  // the literal characters.
  it('greets with the double-brace merge token, not Peerly’s', () => {
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'Oak St is repaved.',
      null,
    )
    expect(composed).toContain(SERVE_SMS_GREETING)
    expect(composed).toContain('{{first_name}}')
    // Win's greeting is untouched and keeps the single-brace form.
    expect(SMS_GREETING).toBe('Hello {first_name},')
  })

  // Why the double brace needs no second ignoredStandardsRules entry: the
  // rule is a substring test, and the inner twelve characters of
  // "{{first_name}}" are exactly "{first_name}". Asserted rather than
  // reasoned about, because the whole Serve compose CTA hangs off it.
  it('still satisfies the first_name_token standards rule', () => {
    expect('{{first_name}}'.includes('{first_name}')).toBe(true)
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'this is Jane, your council member. Oak St is repaved.',
      null,
    )
    const verdict = checkSmsStandards(composed, { candidateNames: ['Jane'] })
    expect(verdict.failures).not.toContain('first_name_token')
    // paid_for_by stays the one and only override.
    expect(verdict.failures).toEqual(['paid_for_by'])
    expect(SERVE_SMS_SURFACE.ignoredStandardsRules).toEqual(['paid_for_by'])
  })

  // The preview substitution is display-only. Asserted on the helper as
  // well as in the flow, because the whole safety of showing a name instead
  // of the token rests on composeMessage staying untouched.
  it('substitutes the sample name for display without changing the script', () => {
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'Oak St is repaved.',
      null,
    )
    expect(composed).toContain('{{first_name}}')
    const shown = withSampleFirstName(composed)
    expect(shown).toContain(`Hello ${SERVE_SMS_SAMPLE_FIRST_NAME},`)
    expect(shown).not.toContain('{{first_name}}')
    expect(shown).not.toContain('{first_name}')
    expect(SMS_GREETING_PREVIEW.greeting).toBe(
      `Hello ${SERVE_SMS_SAMPLE_FIRST_NAME},`,
    )
  })

  it('suggests an outreach campaign name per purpose', () => {
    expect(SERVE_SMS_SURFACE.nameSuggestion('explain_decision')).toBe(
      'Decision update texts',
    )
    expect(SERVE_SMS_SURFACE.nameSuggestion('')).toBe('Text campaign')
  })

  it('sends at a fixed morning hour rather than an hourly slot', () => {
    expect(SERVE_SMS_SURFACE.scheduleMode).toBe('serveFixedMorning')
    expect(SERVE_SMS_SURFACE.isServe).toBe(true)
  })
})
