import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/react'
import type {
  ChatCard,
  ServePhoneBankingCreate,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import {
  ProposalFlowsProvider,
  useOnProposalSent,
  useProposalFlows,
} from './proposalFlows'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('app/(dashboard)/shared/dictation/useDictationAppend', () => ({
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

const errorSnackbar = vi.hoisted(() => vi.fn())
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar, successSnackbar: vi.fn() }),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-riverside' }),
}))

vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => ({ ready: true, enabled: false }),
}))

type Proposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

const SCRIPT = 'Hi, I am calling about the Maple Street drains.'
const PROPOSAL_KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7'

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  kind: 'outreach_proposal',
  proposalKey: PROPOSAL_KEY,
  audience: 'Renters on the flood blocks',
  count: 260,
  channel: 'phoneBanking',
  audienceFilters: { homeownerNo: true },
  listName: 'Flood block renters',
  message: SCRIPT,
  deepLinkOnly: false,
  ...overrides,
})

const Opener = ({ card }: { card: Proposal }) => {
  const flows = useProposalFlows()
  return (
    <button type="button" onClick={() => flows?.open(card, 'priority-1')}>
      Start
    </button>
  )
}

const Listener = ({ sent }: { sent: string[] }) => {
  useOnProposalSent((card) => sent.push(card.proposalKey))
  return null
}

const mockAudience = () => {
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'No elected office' },
  })
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
  api.mock('POST /v1/contacts/count', { status: 200, data: { count: 260 } })
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: {
      demographics: { people: 260, avgAge: null, avgIncome: null },
      reachability: {
        sms: null,
        robocall: null,
        phoneBanking: 260,
        doorKnocking: null,
        polls: null,
      },
      outreachHistory: [],
    },
  })
}

const user = userEvent.setup()

const navigatedToOutreach = () =>
  [...(router.push?.mock.calls ?? []), ...(router.replace?.mock.calls ?? [])]
    .map(([path]) => String(path))
    .filter((path) => path.includes('outreach'))

describe('ProposalFlowsProvider', () => {
  it('opens phone banking over the conversation, never moving the page', async () => {
    mockAudience()

    render(
      <ProposalFlowsProvider>
        <Opener card={proposal()} />
      </ProposalFlowsProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(
      (await screen.findAllByText('Who do you want to reach?')).length,
    ).toBeGreaterThan(0)
    expect(navigatedToOutreach()).toEqual([])

    // Dismissing it (Escape, then discarding the prefilled draft) stays put.
    await user.keyboard('{Escape}')
    const discard = screen.queryByRole('button', { name: /Discard/ })
    if (discard) await user.click(discard)
    expect(navigatedToOutreach()).toEqual([])
  })

  // The agent counts but does not save. The list is saved where the flow
  // always saves one: when the official confirms the audience and names it.
  it('saves the counted audience only when the official confirms it', async () => {
    mockAudience()
    const lists: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      lists.push(body)
      return { status: 200, data: { id: 88, name: 'Flood block renters' } }
    })
    const creates: ServePhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/serve/lists', ({ body }) => {
      creates.push(body)
      return {
        status: 200,
        data: {
          id: 9,
          name: 'Flood block renters',
          sheetCount: 1,
          entryCount: 1,
          personCount: 1,
          outreachId: 90,
          hasMore: false,
        },
      }
    })

    const sent: string[] = []
    render(
      <ProposalFlowsProvider>
        <Opener card={proposal({ stepId: 'define', side: 'contrast' })} />
        <Listener sent={sent} />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))

    const confirm = await screen.findByRole('button', {
      name: /Continue \(\d+\)/,
    })
    // Opened, not yet confirmed: nothing saved.
    expect(lists).toHaveLength(0)
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    await screen.findAllByText('Name your list')
    expect(screen.getByLabelText('List name')).toHaveValue(
      'Flood block renters',
    )
    await user.click(screen.getByRole('button', { name: 'Create list' }))
    await screen.findAllByText('Write your call script')

    expect(lists).toHaveLength(1)
    expect(lists[0]).toMatchObject({
      name: 'Flood block renters',
      homeownerNo: true,
    })
    // The script field is a TokenField: its text lives in the editor.
    expect(
      (
        screen.getByRole('textbox', { name: 'Call script' }) as HTMLElement & {
          editor: Editor
        }
      ).editor.getText(),
    ).toBe(SCRIPT)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText(
      'How many call sheets would you like me to create?',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(creates).toHaveLength(1))
    expect(creates[0]).toMatchObject({
      voterFileFilterId: 88,
      proposalKey: PROPOSAL_KEY,
      priorityId: 'priority-1',
      stepId: 'define',
      side: 'contrast',
    })
    await waitFor(() => expect(sent).toEqual([PROPOSAL_KEY]))
    expect(navigatedToOutreach()).toEqual([])
  })

  // The walk is drawn on its own page, so the card's link rides the URL to
  // that page's create, which puts the check out on the server.
  it('carries the card’s link to door knocking, saving the list at the click', async () => {
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 77, name: 'Flood block renters' },
    })

    render(
      <ProposalFlowsProvider>
        <Opener
          card={proposal({
            channel: 'doorKnocking',
            stepId: 'method',
            side: 'main',
          })}
        />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(router.push).toHaveBeenCalled())
    const url = new URL(
      String(router.push?.mock.calls[0]?.[0]),
      'https://app.test',
    )
    expect(url.pathname).toBe('/door-knocking')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      create: '1',
      listId: '77',
      proposalKey: PROPOSAL_KEY,
      priorityId: 'priority-1',
      stepId: 'method',
      side: 'main',
    })
  })

  it('says so when the walk’s list cannot be saved, and the card can be pressed again', async () => {
    router.push?.mockClear()
    let saves = 0
    api.mock('POST /v1/voters/voter-file/filter', () => {
      saves += 1
      return saves === 1
        ? { status: 500, data: { message: 'down' } }
        : { status: 200, data: { id: 78, name: 'Flood block renters' } }
    })

    render(
      <ProposalFlowsProvider>
        <Opener card={proposal({ channel: 'doorKnocking' })} />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        "We couldn't save this list. Try again.",
      ),
    )
    expect(router.push).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(String(router.push?.mock.calls[0]?.[0])).toContain('listId=78'),
    )
  })

  // A check asks a sample, so the list the drawer saves is the draw, not the
  // live filter, and the count it promises is the sample's.
  it('saves a sampled proposal as that fixed sample', async () => {
    mockAudience()
    const lists: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      lists.push(body)
      return { status: 200, data: { id: 88, name: 'Flood block renters' } }
    })

    render(
      <ProposalFlowsProvider>
        <Opener card={proposal({ sampleSize: 80, widensOutreachIds: [12] })} />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))

    const confirm = await screen.findByRole('button', {
      name: 'Continue (80)',
    })
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)
    await screen.findAllByText('Name your list')
    await user.click(screen.getByRole('button', { name: 'Create list' }))
    await screen.findAllByText('Write your call script')

    expect(lists).toHaveLength(1)
    expect(lists[0]).toMatchObject({
      name: 'Flood block renters',
      homeownerNo: true,
      sample: {
        size: 80,
        seedKey: PROPOSAL_KEY,
        excludeOutreachIds: [12],
      },
    })
  })
})
