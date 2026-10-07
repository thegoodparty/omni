import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { ChatCard } from '@goodparty_org/contracts'
import {
  ProposalFlowsProvider,
  useProposalFlows,
} from 'app/dashboard/shared/agent-chat/cards/proposalFlows'

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

vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => ({ ready: true, enabled: true }),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

type Proposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

// A card persisted before the server guard: its own introduction, with a
// placeholder, which once reached the drawer behind a second, compliant one.
const PERSISTED_DRAFT =
  "Hi, this is [Your Name] from the City of Asheville. We're working on expanding composting options. Would you use a drop-off site?"

const card: Proposal = {
  kind: 'outreach_proposal',
  proposalKey: '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7',
  audience: 'Northside residents',
  count: 1200,
  channel: 'text',
  savedFilterId: 41,
  message: PERSISTED_DRAFT,
  deepLinkOnly: false,
}

const Opener = () => {
  const flows = useProposalFlows()
  return (
    <button type="button" onClick={() => flows?.open(card, 'priority-1')}>
      Start the text
    </button>
  )
}

describe('a text card, through the drawer', () => {
  beforeEach(() => {
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
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reaches the compose step with exactly one introduction', async () => {
    render(
      <ProposalFlowsProvider>
        <Opener />
      </ProposalFlowsProvider>,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Start the text' }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: /^Friday, September 4(?!\d)/,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The field holds the whole message: greeting, body and opt-out.
    const box = await screen.findByRole('textbox', { name: 'Message body' })
    const message = () =>
      (box as HTMLElement & { editor: Editor }).editor.getText({
        blockSeparator: '\n',
      })
    await waitFor(() =>
      expect(message()).toMatch(/^Hello \{\{first_name\}\}, this is Jane, /),
    )
    expect(message().match(/this is/gi)).toHaveLength(1)
    expect(message()).not.toContain('[')
    expect(message()).toContain(
      "We're working on expanding composting options.",
    )
    expect(message().match(/\b(?:hello|hi|hey)\b/gi)).toHaveLength(1)
  })
})
