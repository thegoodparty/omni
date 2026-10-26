import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { PollFlow } from './PollFlow'
import { SERVE_POLL_QUESTION_COPY } from './pollCopy'

// No test here is about hover, and the pointer move user-event makes before
// every click fires a round of hover events (and re-renders) for nothing.
let user: ReturnType<typeof userEvent.setup>
beforeEach(() => {
  user = userEvent.setup({ skipHover: true })
})

const LEADING_QUESTION = "Isn't the pothole crisis the city's biggest failure?"

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

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

describe('PollFlow bias check', () => {
  beforeEach(() => {
    draftBodies.length = 0
    createBodies.length = 0
    createCheckoutSession.mockClear()
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

    mswServer.use(
      http.post('*/v1/polls/analyze-bias', () =>
        HttpResponse.json(
          {
            bias_spans: [
              { start: 0, end: 5, reason: 'Leading phrasing' },
              { start: 17, end: 23, reason: 'Loaded word' },
            ],
            grammar_spans: [],
            rewritten_text: 'How do you feel about road repairs?',
          },
          { status: 201 },
        ),
      ),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const writeLeadingQuestion = async () => {
    openFlow()
    await pickTopic('Write my own')
    await user.click(
      await screen.findByRole('button', { name: /^Continue/ }),
    )
    const field = (await screen.findByRole('textbox', {
      name: 'Poll question',
    })) as HTMLElement & { editor: Editor }
    act(() => {
      field.editor.commands.setContent(LEADING_QUESTION)
    })
  }

  it('checks the question when the official leaves the field, not while typing', async () => {
    await writeLeadingQuestion()

    expect(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.checkBias }),
    ).toBeInTheDocument()

    fireEvent.focusOut(screen.getByRole('textbox', { name: 'Poll question' }))

    expect(
      await screen.findByText(SERVE_POLL_QUESTION_COPY.biasFlagged),
    ).toBeInTheDocument()
    expect(
      screen.getByText(SERVE_POLL_QUESTION_COPY.biasFlaggedNote),
    ).toBeInTheDocument()
  })

  it('holds the official on the What step until the bias check reports, then shows the flag', async () => {
    await writeLeadingQuestion()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText(SERVE_POLL_QUESTION_COPY.biasFlaggedNote),
    ).toBeInTheDocument()
    expect(screen.getByText('Your question')).toBeInTheDocument()
    expect(createBodies).toHaveLength(0)
  })

  it('shows a pass when the analyzer finds nothing', async () => {
    mswServer.use(
      http.post('*/v1/polls/analyze-bias', () =>
        HttpResponse.json(
          { bias_spans: [], grammar_spans: [], rewritten_text: '' },
          { status: 201 },
        ),
      ),
    )
    await writeLeadingQuestion()

    await user.click(
      screen.getByRole('button', { name: 'Check for bias' }),
    )

    expect(
      await screen.findByText(SERVE_POLL_QUESTION_COPY.biasPassed),
    ).toBeInTheDocument()
  })

  it('shows the status as a shield with a tooltip on a phone', async () => {
    const matchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    try {
      mswServer.use(
        http.post('*/v1/polls/analyze-bias', () =>
          HttpResponse.json(
            { bias_spans: [], grammar_spans: [], rewritten_text: '' },
            { status: 201 },
          ),
        ),
      )
      await writeLeadingQuestion()
      await user.click(
        screen.getByRole('button', { name: 'Check for bias' }),
      )

      const label = await screen.findByText(SERVE_POLL_QUESTION_COPY.biasPassed)
      expect(label).toHaveClass('sr-only')
      const status = label.closest<HTMLElement>('[role="status"]')!

      // Focus stands in for the tap: the styleguide's own tooltip tests cover
      // openOnClick, and the modal flow blocks user-event's pointer here.
      act(() => status.focus())

      expect(
        (
          await screen.findAllByText(
            SERVE_POLL_QUESTION_COPY.biasTooltip.passed,
          )
        ).length,
      ).toBeGreaterThan(0)
    } finally {
      window.matchMedia = matchMedia
    }
  })

  it('rewrites the question with Improve with AI', async () => {
    await writeLeadingQuestion()

    await user.click(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.improve }),
    )

    const field = screen.getByRole('textbox', {
      name: 'Poll question',
    }) as HTMLElement & { editor: Editor }
    await waitFor(() =>
      expect(field.editor.getText()).toBe(
        'How do you feel about road repairs?',
      ),
    )
  })

  it('says so when Improve with AI finds nothing to change', async () => {
    mswServer.use(
      http.post('*/v1/polls/analyze-bias', () =>
        HttpResponse.json(
          {
            bias_spans: [],
            grammar_spans: [],
            rewritten_text: LEADING_QUESTION,
          },
          { status: 201 },
        ),
      ),
    )
    await writeLeadingQuestion()

    await user.click(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.improve }),
    )

    expect(
      await screen.findByText(SERVE_POLL_QUESTION_COPY.improveUnchanged),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: SERVE_POLL_QUESTION_COPY.undo }),
    ).toBeNull()
  })

  it('improves a question of any length and offers a retry when it fails', async () => {
    let calls = 0
    mswServer.use(
      http.post('*/v1/polls/analyze-bias', () => {
        calls += 1
        return calls === 1
          ? HttpResponse.json({ message: 'down' }, { status: 500 })
          : HttpResponse.json(
              {
                bias_spans: [],
                grammar_spans: [],
                rewritten_text: 'What would you change about our parks?',
              },
              { status: 201 },
            )
      }),
    )
    openFlow()
    await pickTopic('Write my own')
    await user.click(
      await screen.findByRole('button', { name: /^Continue/ }),
    )
    const field = (await screen.findByRole('textbox', {
      name: 'Poll question',
    })) as HTMLElement & { editor: Editor }
    act(() => {
      field.editor.commands.setContent('parks?')
    })

    await user.click(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.improve }),
    )
    await user.click(
      await screen.findByRole('button', {
        name: SERVE_POLL_QUESTION_COPY.tryAgain,
      }),
    )

    await waitFor(() =>
      expect(field.editor.getText()).toBe(
        'What would you change about our parks?',
      ),
    )
  })

  it('offers Undo after Improve with AI replaces the official own words', async () => {
    await writeLeadingQuestion()
    const field = screen.getByRole('textbox', {
      name: 'Poll question',
    }) as HTMLElement & { editor: Editor }

    await user.click(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.improve }),
    )
    await waitFor(() =>
      expect(field.editor.getText()).toBe(
        'How do you feel about road repairs?',
      ),
    )
    await user.click(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.undo }),
    )

    expect(field.editor.getText()).toBe(LEADING_QUESTION)
    expect(
      screen.queryByRole('button', { name: SERVE_POLL_QUESTION_COPY.undo }),
    ).toBeNull()
  })

  it('keeps Continue disabled while the question is flagged, until it is reworded', async () => {
    await writeLeadingQuestion()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText(SERVE_POLL_QUESTION_COPY.biasFlaggedNote)

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    const field = screen.getByRole('textbox', {
      name: 'Poll question',
    }) as HTMLElement & { editor: Editor }
    act(() => {
      field.editor.commands.setContent('How do you feel about road repairs?')
    })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    expect(createBodies).toHaveLength(0)
  })

  // An analyzer that answers only when the test lets it.
  const heldAnalyzer = (
    biasSpans: { start: number; end: number; reason: string }[],
  ) => {
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    mswServer.use(
      http.post('*/v1/polls/analyze-bias', async () => {
        await released
        return HttpResponse.json(
          {
            bias_spans: biasSpans,
            grammar_spans: [],
            rewritten_text: 'How do you feel about road repairs?',
          },
          { status: 201 },
        )
      }),
    )
    return () => release()
  }

  it('does not move on when the question changed while Continue was checking it', async () => {
    const release = heldAnalyzer([])
    await writeLeadingQuestion()
    const field = screen.getByRole('textbox', {
      name: 'Poll question',
    }) as HTMLElement & { editor: Editor }

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    act(() => {
      field.editor.commands.setContent('What should the city fix first?')
    })
    release()

    await waitFor(() =>
      expect(
        screen.queryByText(SERVE_POLL_QUESTION_COPY.checkingBias),
      ).toBeNull(),
    )
    expect(screen.getByText('Your question')).toBeInTheDocument()
  })

  it('drops an Improve that answers after the question was edited', async () => {
    const release = heldAnalyzer([])
    await writeLeadingQuestion()
    const field = screen.getByRole('textbox', {
      name: 'Poll question',
    }) as HTMLElement & { editor: Editor }

    await user.click(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.improve }),
    )
    // The field is read-only while Improve runs, so the edit arrives the way
    // a reset or a new draft would: from outside the editor.
    await user.click(screen.getByRole('radio', { name: 'Warm' }))
    release()

    await waitFor(() => expect(draftBodies.length).toBeGreaterThan(0))
    await waitFor(() =>
      expect(field.editor.getText()).toBe(
        'How safe do you feel in your neighborhood?',
      ),
    )
  })

  it('moves on with one Continue press when leaving the field started the check', async () => {
    const release = heldAnalyzer([])
    await writeLeadingQuestion()

    // The press blurs the field first, which starts the check.
    fireEvent.focusOut(screen.getByRole('textbox', { name: 'Poll question' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    release()

    expect(
      await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    ).toBeInTheDocument()
  })

  it('tells a flagged question to be edited when Improve cannot reword it', async () => {
    mswServer.use(
      http.post('*/v1/polls/analyze-bias', () =>
        HttpResponse.json(
          {
            bias_spans: [{ start: 0, end: 5, reason: 'Leading phrasing' }],
            grammar_spans: [],
            rewritten_text: LEADING_QUESTION,
          },
          { status: 201 },
        ),
      ),
    )
    await writeLeadingQuestion()
    fireEvent.focusOut(screen.getByRole('textbox', { name: 'Poll question' }))
    await screen.findByText(SERVE_POLL_QUESTION_COPY.biasFlagged)

    await user.click(
      screen.getByRole('button', { name: SERVE_POLL_QUESTION_COPY.improve }),
    )

    expect(
      await screen.findByText(SERVE_POLL_QUESTION_COPY.improveStuck),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(SERVE_POLL_QUESTION_COPY.improveUnchanged),
    ).toBeNull()
  })

  it('keeps the verdict on the current words when an older check answers late', async () => {
    const REWORDED = "Isn't the pothole crisis a total disaster for us all?"
    let releaseOld: () => void = () => undefined
    const oldReleased = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    mswServer.use(
      http.post('*/v1/polls/analyze-bias', async ({ request }) => {
        const { pollText } = (await request.json()) as { pollText: string }
        if (pollText === LEADING_QUESTION) {
          await oldReleased
          return HttpResponse.json(
            { bias_spans: [], grammar_spans: [], rewritten_text: pollText },
            { status: 201 },
          )
        }
        return HttpResponse.json(
          {
            bias_spans: [{ start: 0, end: 5, reason: 'Leading phrasing' }],
            grammar_spans: [],
            rewritten_text: pollText,
          },
          { status: 201 },
        )
      }),
    )
    await writeLeadingQuestion()
    const field = screen.getByRole('textbox', {
      name: 'Poll question',
    }) as HTMLElement & { editor: Editor }

    fireEvent.focusOut(field)
    act(() => {
      field.editor.commands.setContent(REWORDED)
    })
    fireEvent.focusOut(field)
    await screen.findByText(SERVE_POLL_QUESTION_COPY.biasFlagged)

    releaseOld()

    await waitFor(() =>
      expect(
        screen.queryByText(SERVE_POLL_QUESTION_COPY.checkingBias),
      ).toBeNull(),
    )
    expect(
      screen.getByText(SERVE_POLL_QUESTION_COPY.biasFlagged),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('lets the official continue when the bias check is down', async () => {
    mswServer.use(
      http.post('*/v1/polls/analyze-bias', () =>
        HttpResponse.json({ message: 'down' }, { status: 500 }),
      ),
    )
    await writeLeadingQuestion()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    ).toBeInTheDocument()
  })
})
