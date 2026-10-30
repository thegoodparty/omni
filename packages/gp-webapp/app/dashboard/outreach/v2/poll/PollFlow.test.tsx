import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { PollFlow } from './PollFlow'

// No test here is about hover, and the pointer move user-event makes before
// every click fires a round of hover events (and re-renders) for nothing.
let user: ReturnType<typeof userEvent.setup>
beforeEach(() => {
  user = userEvent.setup({ skipHover: true })
})

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// The question field is a TokenField: its text lives in the editor TipTap
// hangs on the textbox, not in a `value`.
const questionEditor = () =>
  (
    screen.getByRole('textbox', { name: 'Poll question' }) as HTMLElement & {
      editor: Editor
    }
  ).editor
const questionText = () => questionEditor().getText({ blockSeparator: '\n' })
const typeQuestion = (text: string) =>
  act(() => {
    questionEditor().commands.setContent(text)
  })

const analyzeBias = (
  biasSpans: { start: number; end: number; reason: string }[],
) =>
  http.post('*/v1/polls/analyze-bias', () =>
    HttpResponse.json(
      {
        bias_spans: biasSpans,
        grammar_spans: [],
        rewritten_text: 'How do you feel about road repairs?',
      },
      { status: 201 },
    ),
  )

const createCheckoutSession = vi.fn(
  async (_type: string, _meta: Record<string, unknown>) => ({
    ok: true,
    // amount 0 keeps review on its free branch, the only one that renders in
    // jsdom (the paid card mounts real Stripe elements).
    data: { id: 'cs_1', clientSecret: '', amount: 0 },
  }),
)
vi.mock('app/dashboard/purchase/utils/purchaseFetch.utils', () => ({
  createCheckoutSession: (type: string, meta: Record<string, unknown>) =>
    createCheckoutSession(type, meta),
  completeCheckoutSession: vi.fn(async () => ({ ok: true })),
  completeFreePurchase: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [null, vi.fn()],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({
    slug: 'eo-jane-doe',
    district: {},
    positionName: 'City Council',
  }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [
    { id: 1, firstName: 'Jane', lastName: 'Doe' },
    vi.fn(),
    false,
  ],
}))

// Tuesday, so Friday the 4th is the first open day inside the month.
const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

const draftBodies: Record<string, unknown>[] = []
const createBodies: Record<string, unknown>[] = []

const openFlow = () => {
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(<PollFlow open onClose={vi.fn()} onScheduled={onScheduled} />)
  return { onScheduled }
}

const pickTopic = async (label: string) =>
  user.click(await screen.findByText(label))

const throughQuestion = async () => {
  await screen.findByRole('textbox', { name: 'Poll question' })
  await waitFor(() => expect(questionText()).not.toBe(''))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(
    await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('PollFlow', () => {
  beforeEach(() => {
    draftBodies.length = 0
    createBodies.length = 0
    createCheckoutSession.mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
    mswServer.use(analyzeBias([]))

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
          email: 0,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    api.mock('GET /v1/contacts/stats', {
      status: 200,
      data: {
        districtId: 'd1',
        computedAt: '2026-09-01T00:00:00Z',
        totalConstituents: 12000,
        totalConstituentsWithCellPhone: 10000,
        districtPopulation: null,
        buckets: {
          age: [],
          homeowner: [],
          education: [],
          presenceOfChildren: [],
          estimatedIncomeRange: [],
        },
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
    api.mock('POST /v1/outreach/serve/poll/draft', ({ body }) => {
      draftBodies.push(body as unknown as Record<string, unknown>)
      return {
        status: 200,
        data: { question: 'How safe do you feel in your neighborhood?' },
      }
    })
    api.mock('POST /v1/outreach/serve/poll', ({ body }) => {
      createBodies.push(body as unknown as Record<string, unknown>)
      return {
        status: 200,
        data: { outreachId: 91, recipientCount: 2700, amountCents: 9450 },
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drafts from the topic with the default tone and shows the question', async () => {
    openFlow()
    await pickTopic('Public safety')

    await user.click(await screen.findByRole('button', { name: /^Continue/ }))

    await screen.findByRole('textbox', { name: 'Poll question' })
    await waitFor(() =>
      expect(questionText()).toBe('How safe do you feel in your neighborhood?'),
    )
    expect(draftBodies).toEqual([{ topic: 'public_safety', tone: 'Neutral' }])
  })

  it('redrafts from the current question when the tone changes', async () => {
    openFlow()
    await pickTopic('Public safety')
    await user.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByRole('textbox', { name: 'Poll question' })
    await waitFor(() => expect(questionText()).toMatch(/How safe/))

    await user.click(screen.getByRole('radio', { name: 'Warm' }))

    await waitFor(() => expect(draftBodies).toHaveLength(2))
    expect(draftBodies[1]).toEqual({
      topic: 'public_safety',
      tone: 'Warm',
      currentDraft: 'How safe do you feel in your neighborhood?',
    })
  })

  it("does not offer the previous topic's question as Undo on a new topic", async () => {
    api.mock('POST /v1/outreach/serve/poll/draft', ({ body }) => ({
      status: 200,
      data: {
        question:
          (body as { topic: string }).topic === 'housing'
            ? 'How affordable is housing where you live?'
            : 'How safe do you feel in your neighborhood?',
      },
    }))
    openFlow()
    await pickTopic('Public safety')
    await user.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByRole('textbox', { name: 'Poll question' })
    await waitFor(() => expect(questionText()).toMatch(/How safe/))

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    await pickTopic('Housing')
    await user.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByRole('textbox', { name: 'Poll question' })
    await waitFor(() => expect(questionText()).toMatch(/affordable/))

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('offers Undo after Regenerate replaces the drafted question', async () => {
    let drafts = 0
    api.mock('POST /v1/outreach/serve/poll/draft', () => {
      drafts += 1
      return {
        status: 200,
        data: {
          question:
            drafts === 1
              ? 'How safe do you feel in your neighborhood?'
              : 'What would make your street feel safer?',
        },
      }
    })
    openFlow()
    await pickTopic('Public safety')
    await user.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByRole('textbox', { name: 'Poll question' })
    await waitFor(() => expect(questionText()).toMatch(/How safe/))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(questionText()).toMatch(/street/))
    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(questionText()).toBe('How safe do you feel in your neighborhood?')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('previews the greeting with a name, titles the step as a question, and suggests for the audience', async () => {
    openFlow()
    await pickTopic('Public safety')
    await user.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByRole('textbox', { name: 'Poll question' })
    await waitFor(() => expect(questionText()).toMatch(/How safe/))

    expect(
      screen.getAllByText('What do you want to say?').length,
    ).toBeGreaterThan(0)
    expect(screen.getByText(/^Hi Sam, this is Jane Doe/)).toBeInTheDocument()
    expect(screen.queryByText(/first_name/)).toBeNull()
    expect(
      screen.getByText('Suggested for Random sample of constituents'),
    ).toBeInTheDocument()
    for (const tone of ['Neutral', 'Warm', 'Direct', 'Friendly']) {
      expect(
        screen.getByRole('radio', { name: tone }).querySelector('svg'),
      ).not.toBeNull()
    }
  })

  it('suggests nothing for a question the official writes themselves', async () => {
    openFlow()
    await pickTopic('Write my own')
    await user.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByText('Your question')

    expect(screen.queryByText(/^Suggested for/)).toBeNull()
  })

  it('asks a question on the review step and keeps campaign out of the poll copy', async () => {
    openFlow()
    await pickTopic('Public safety')
    await user.click(
      await screen.findByRole('button', { name: /^Continue \(2,767\)$/ }),
    )
    await throughQuestion()

    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: 'Ready to send your poll?',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Review your poll details and schedule your send.'),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Schedule poll' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/campaign/i)).toBeNull()
  })

  it('creates the poll for a sample audience', async () => {
    openFlow()
    await pickTopic('Public safety')
    await user.click(
      await screen.findByRole('button', { name: /^Continue \(2,767\)$/ }),
    )
    await throughQuestion()

    await waitFor(() => expect(createBodies).toHaveLength(1))
    expect(createBodies[0]).toEqual({
      topic: 'public_safety',
      tone: 'Neutral',
      question: 'How safe do you feel in your neighborhood?',
      audience: { kind: 'sample', size: 2767 },
      scheduledLocalDate: '2026-09-04',
      biasOverridden: false,
    })
    await waitFor(() =>
      expect(createCheckoutSession).toHaveBeenCalledWith(
        'SERVE_TEXT',
        expect.objectContaining({ outreachId: 91 }),
      ),
    )
  })

  it('creates against a saved list when one is picked', async () => {
    openFlow()
    await pickTopic('Housing')
    await user.click(await screen.findByText('Choose a constituent list'))
    await user.click(await screen.findByText('Northside residents'))
    await user.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await throughQuestion()

    await waitFor(() => expect(createBodies).toHaveLength(1))
    expect(createBodies[0]).toMatchObject({
      topic: 'housing',
      audience: { kind: 'list', voterFileFilterId: 41 },
    })
  })

  it('writes a fresh poll after the flow is closed and reopened', async () => {
    const onScheduled = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <PollFlow open onClose={vi.fn()} onScheduled={onScheduled} />,
    )
    await pickTopic('Public safety')
    await user.click(
      await screen.findByRole('button', { name: /^Continue \(2,767\)$/ }),
    )
    await throughQuestion()
    await waitFor(() => expect(createBodies).toHaveLength(1))

    rerender(
      <PollFlow open={false} onClose={vi.fn()} onScheduled={onScheduled} />,
    )
    rerender(<PollFlow open onClose={vi.fn()} onScheduled={onScheduled} />)

    await pickTopic('Housing')
    await user.click(
      await screen.findByRole('button', { name: /^Continue \(2,767\)$/ }),
    )
    await throughQuestion()

    await waitFor(() => expect(createBodies).toHaveLength(2))
    expect(createBodies[1]).toMatchObject({ topic: 'housing' })
  })

  it('does not count trailing whitespace against the question limit', async () => {
    openFlow()
    await pickTopic('Write my own')
    await user.click(await screen.findByRole('button', { name: /^Continue/ }))
    await screen.findByRole('textbox', { name: 'Poll question' })
    await typeQuestion(`${'a'.repeat(480)} `)

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    ).toBeInTheDocument()
  })

  it('never runs two creates at once when Back and Continue race a slow create', async () => {
    let release: () => void = () => undefined
    let inFlight = 0
    let maxInFlight = 0
    api.mock('POST /v1/outreach/serve/poll', async ({ body }) => {
      createBodies.push(body as unknown as Record<string, unknown>)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (createBodies.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      inFlight -= 1
      return {
        status: 200,
        data: {
          outreachId: 90 + createBodies.length,
          recipientCount: 2700,
          amountCents: 9450,
        },
      }
    })
    openFlow()
    await pickTopic('Public safety')
    await user.click(
      await screen.findByRole('button', { name: /^Continue \(2,767\)$/ }),
    )
    await throughQuestion()
    await waitFor(() => expect(createBodies).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    release()

    await waitFor(() => expect(createBodies).toHaveLength(2))
    expect(maxInFlight).toBe(1)
  })
})
