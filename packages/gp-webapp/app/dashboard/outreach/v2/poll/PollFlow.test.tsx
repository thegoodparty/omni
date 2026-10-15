import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { PollFlow } from './PollFlow'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// The real input analyzes on blur against /v1/polls/analyze-bias; the flow
// only reads the state it reports, so a stub that reports it is enough.
vi.mock(
  'app/dashboard/polls/shared/components/poll-text-bias/PollTextBiasInput',
  () => ({
    default: ({
      value,
      onChange,
      onBiasAnalysisChange,
    }: {
      value: string
      onChange: (value: string) => void
      onBiasAnalysisChange?: (state: {
        hasBias: boolean
        hasGrammar: boolean
        hasServerError: boolean
        hasBeenChecked: boolean
      }) => void
    }) => (
      <div>
        <textarea
          aria-label="Poll question"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            onBiasAnalysisChange?.({
              hasBias: true,
              hasGrammar: false,
              hasServerError: false,
              hasBeenChecked: true,
            })
          }
        >
          Flag bias
        </button>
      </div>
    ),
  }),
)

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

const throughQuestion = async () => {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Flag bias' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.click(
    await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('PollFlow', () => {
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drafts from the topic with the default tone and shows the question', async () => {
    openFlow()
    await pickTopic('Public safety')

    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue/ }),
    )

    expect(await screen.findByLabelText('Poll question')).toHaveValue(
      'How safe do you feel in your neighborhood?',
    )
    expect(draftBodies).toEqual([{ topic: 'public_safety', tone: 'Neutral' }])
  })

  it('redrafts from the current question when the tone changes', async () => {
    openFlow()
    await pickTopic('Public safety')
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue/ }),
    )
    await screen.findByDisplayValue(/How safe/)

    await userEvent.click(screen.getByRole('radio', { name: 'Warm' }))

    await waitFor(() => expect(draftBodies).toHaveLength(2))
    expect(draftBodies[1]).toEqual({
      topic: 'public_safety',
      tone: 'Warm',
      currentDraft: 'How safe do you feel in your neighborhood?',
    })
  })

  it('sends biasOverridden when the official continues past a bias flag, with a sample audience', async () => {
    openFlow()
    await pickTopic('Public safety')
    await userEvent.click(
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
      biasOverridden: true,
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
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
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
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(2,767\)$/ }),
    )
    await throughQuestion()
    await waitFor(() => expect(createBodies).toHaveLength(1))

    rerender(
      <PollFlow open={false} onClose={vi.fn()} onScheduled={onScheduled} />,
    )
    rerender(<PollFlow open onClose={vi.fn()} onScheduled={onScheduled} />)

    await pickTopic('Housing')
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(2,767\)$/ }),
    )
    await throughQuestion()

    await waitFor(() => expect(createBodies).toHaveLength(2))
    expect(createBodies[1]).toMatchObject({ topic: 'housing' })
  })
})
