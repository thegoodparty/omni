import { beforeEach, describe, expect, it, vi } from 'vitest'
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

// Lists saved so far, so the flow's own list read finds the one the card
// saved, the way the server would return it.
const mockSavedLists = () => {
  const lists: Record<string, unknown>[] = []
  api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
    lists.push(body)
    return { status: 200, data: { id: 88, name: 'Flood block renters' } }
  })
  api.mock('GET /v1/voters/voter-file/filters', () => ({
    status: 200,
    data: lists.map(() => ({ id: 88, name: 'Flood block renters' })),
  }))
  return lists
}

describe('ProposalFlowsProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  // The card already settled who gets this, so the flow saves the list and
  // opens the standard flow on the script with that list picked behind it.
  it('opens phone banking on the script over the conversation, the list saved once', async () => {
    mockAudience()
    const lists = mockSavedLists()

    render(
      <ProposalFlowsProvider>
        <Opener card={proposal()} />
      </ProposalFlowsProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))

    await screen.findAllByText('Write your call script')
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 3 of 5',
    )
    expect(screen.queryByTestId('proposal-audience-summary')).toBeNull()
    expect(screen.queryByText('Change who gets this')).toBeNull()
    expect(lists).toHaveLength(1)
    expect(navigatedToOutreach()).toEqual([])

    // Back walks the standard flow: the card's list, picked, then the
    // purpose.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Flood block renters')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Step 2 of 5',
    )
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      await screen.findByRole('button', { name: /Write my own script/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('reuses the list it saved when the card is opened again', async () => {
    mockAudience()
    const lists = mockSavedLists()

    const { unmount } = render(
      <ProposalFlowsProvider>
        <Opener card={proposal()} />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findAllByText('Write your call script')
    unmount()

    render(
      <ProposalFlowsProvider>
        <Opener card={proposal()} />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findAllByText('Write your call script')
    expect(lists).toHaveLength(1)
    expect(navigatedToOutreach()).toEqual([])
  })

  it('sends the calls on the list the card saved', async () => {
    mockAudience()
    const lists = mockSavedLists()
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
  // that page's create, which puts the check out on the server. A priority's
  // walk asks the check's question, so the goal and the question ride too.
  it('carries the card’s link, goal and question to door knocking, saving the list at the click', async () => {
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
    expect(url.pathname).toBe('/dashboard/door-knocking')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      create: '1',
      listId: '77',
      proposalKey: PROPOSAL_KEY,
      priorityId: 'priority-1',
      stepId: 'method',
      side: 'main',
      launchSource: 'priorities',
      purpose: 'community_input',
      question: SCRIPT,
    })
  })

  // The question has the create's own limit, so a longer door message is
  // cut to it rather than opening a walk that cannot be created.
  it('cuts a door message longer than a question can be', async () => {
    router.push?.mockClear()
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 80, name: 'Flood block renters' },
    })

    render(
      <ProposalFlowsProvider>
        <Opener
          card={proposal({ channel: 'doorKnocking', message: 'a'.repeat(400) })}
        />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(router.push).toHaveBeenCalled())
    const url = new URL(
      String(router.push?.mock.calls[0]?.[0]),
      'https://app.test',
    )
    expect(url.searchParams.get('question')).toBe('a'.repeat(300))
  })

  it('saves the walk’s list once when the card is pressed twice', async () => {
    router.push?.mockClear()
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let saves = 0
    api.mock('POST /v1/voters/voter-file/filter', async () => {
      saves += 1
      await held
      return { status: 200, data: { id: 79, name: 'Flood block renters' } }
    })

    render(
      <ProposalFlowsProvider>
        <Opener card={proposal({ channel: 'doorKnocking' })} />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    release()

    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1))
    expect(saves).toBe(1)

    // Back on the card, pressing it again reuses the list it saved.
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(2))
    expect(saves).toBe(1)
    expect(String(router.push?.mock.calls[1]?.[0])).toContain('listId=79')
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

  // A check asks a sample, so the list the card saves is the draw, not the
  // live filter.
  it('saves a sampled proposal as that fixed sample', async () => {
    mockAudience()
    const lists = mockSavedLists()

    render(
      <ProposalFlowsProvider>
        <Opener card={proposal({ sampleSize: 80, widensOutreachIds: [12] })} />
      </ProposalFlowsProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
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
