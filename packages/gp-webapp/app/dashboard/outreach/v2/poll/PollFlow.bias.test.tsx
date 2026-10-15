import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { PollFlow } from './PollFlow'
import { SERVE_POLL_QUESTION_COPY } from './pollCopy'

const LEADING_QUESTION = "Isn't the pothole crisis the city's biggest failure?"

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('app/dashboard/polls/components/PollImageUpload', () => ({
  PollImageUpload: () => <div>Image upload</div>,
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
  userEvent.click(await screen.findByText(label))

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
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue/ }),
    )
    await screen.findByText('Your question')
    const editor = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[contenteditable]')
      if (!found) throw new Error('editor not rendered')
      return found
    })
    editor.focus()
    editor.textContent = LEADING_QUESTION
    fireEvent.input(editor)
    return editor
  }

  it('holds the official on the What step until the bias check reports, then shows the alert', async () => {
    await writeLeadingQuestion()

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText(SERVE_POLL_QUESTION_COPY.biasAlertTitle),
    ).toBeInTheDocument()
    expect(screen.getByText('Your question')).toBeInTheDocument()
    expect(createBodies).toHaveLength(0)
  })

  it('sends biasOverridden when the official continues past the alert', async () => {
    await writeLeadingQuestion()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText(SERVE_POLL_QUESTION_COPY.biasAlertTitle)

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(createBodies).toHaveLength(1))
    expect(createBodies[0]).toMatchObject({
      question: LEADING_QUESTION,
      biasOverridden: true,
    })
  })
})
