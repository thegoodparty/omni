import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { createP2pPhoneList } from 'helpers/createP2pPhoneList'
import { SmsFlow } from './SmsFlow'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('helpers/createP2pPhoneList', () => ({
  createP2pPhoneList: vi.fn(async () => ({ ok: true, token: 'tok-1' })),
  getP2pPhoneListStatus: vi.fn(async () => ({
    phoneListId: 77,
    leadsLoaded: 19000,
    excludedOptedOutCount: 0,
    excludedDuplicatePhoneCount: 0,
  })),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [
    {
      id: 9,
      isPro: true,
      hasFreeTextsOffer: false,
      details: { normalizedOffice: 'City Council' },
    },
    vi.fn(),
  ],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-9', district: {} }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ id: 1, firstName: 'Jane' }, vi.fn(), false],
}))

const RECOMMENDATION = {
  variant: 'persuadeAffinity' as const,
  intent: 'persuade' as const,
  filter: { independentAffinity: true, voterStatus: ['Super', 'Likely'] },
  count: 19000,
  voteGoalShare: 0.48,
  estimatedCostCents: 66_500,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity voters',
  },
  existingFilterId: null,
}

const EXISTING_RECOMMENDATION = {
  ...RECOMMENDATION,
  variant: 'persuadeUndecided' as const,
  copy: {
    title: 'Undecided persuadables',
    criteriaSummary: 'Undecided voters',
  },
  existingFilterId: 501,
}

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'No elected office' },
  })
  api.mock('GET /v1/outreach', { status: 200, data: [] })
})

const acceptedCalls = () =>
  vi
    .mocked(trackEvent)
    .mock.calls.filter(
      ([name]) => name === EVENTS.Outreach.RecommendedList.Accepted,
    )

const openToAudience = async () => {
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(<SmsFlow open onClose={onClose} onScheduled={onScheduled} />)
  await userEvent.click(screen.getByText('Introduce myself to voters'))
  expect(
    (await screen.findAllByText('Who do you want to reach?')).length,
  ).toBeGreaterThan(0)
}

// Arriving from the voter data page with `?recommended=`: the card already
// answered "What do you want to do?", so the flow opens on the audience step
// with the variant's purpose picked, asks for that one variant cut for SMS,
// and the audience step applies it on arrival.
describe('SmsFlow — a recommendation carried in from the voter data page', () => {
  it('skips the purpose step, fetches the variant for this channel and arrives with it selected, saving it on Continue', async () => {
    const queries: Record<string, unknown>[] = []
    api.mock('GET /v1/campaigns/mine/recommended-lists', ({ query }) => {
      queries.push(query)
      return {
        status: 200,
        data:
          query.variant === 'electionDayAffinity'
            ? [
                {
                  ...RECOMMENDATION,
                  variant: 'electionDayAffinity' as const,
                  intent: 'electionDay' as const,
                  copy: {
                    title: 'Turn out independent-leaning voters',
                    criteriaSummary: 'Moderate propensity independents',
                  },
                },
              ]
            : [],
      }
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 19000 } })
    const filterCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return {
        status: 200,
        data: { id: 88, name: body.name, recommendedModified: false },
      }
    })
    render(
      <SmsFlow
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        preselectedRecommendedVariant="electionDayAffinity"
      />,
    )

    // No purpose question: the card carried its intent, and the audience
    // step is the first thing on screen.
    expect(
      (await screen.findAllByText('Who do you want to reach?')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Introduce myself to voters')).toBeNull()

    // Cut for this channel — and already the chosen audience, as the
    // prototype has it: the card reads pressed, nothing asks for a name, and
    // Continue carries its count.
    const card = await screen.findByTestId('recommended-list-card')
    await waitFor(() => expect(card).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByRole('textbox', { name: 'List name' })).toBeNull()
    expect(queries).toContainEqual(
      expect.objectContaining({
        channel: 'sms',
        variant: 'electionDayAffinity',
      }),
    )
    expect(screen.getByTestId('recommended-list-card')).toHaveTextContent(
      'Turn out independent-leaning voters',
    )

    const continueButton = await screen.findByRole('button', {
      name: 'Continue (19,000)',
    })
    expect(continueButton).toBeEnabled()
    await userEvent.click(continueButton)

    // Saved under the recommendation's own title, then the phone list is
    // derived from it exactly as a named list's would be. Provenance is the
    // variant's own intent, not the purpose the candidate happened to pick
    // to get here.
    await waitFor(() => expect(filterCalls).toHaveLength(1))
    expect(filterCalls[0]).toMatchObject({
      name: 'Turn out independent-leaning voters',
      recommendedVariant: 'electionDayAffinity',
      recommendedChannel: 'sms',
      recommendedIntent: 'electionDay',
    })
    await waitFor(() => expect(acceptedCalls()).toHaveLength(1))
    expect(acceptedCalls()[0]?.[1]).toMatchObject({
      variant: 'electionDayAffinity',
      channel: 'sms',
      intent: 'electionDay',
    })
    await waitFor(() =>
      expect(createP2pPhoneList).toHaveBeenCalledWith(
        expect.objectContaining({ id: 88 }),
        88,
      ),
    )
  })

  it('shows the failure under the cards when saving the selected recommendation fails', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', ({ query }) => ({
      status: 200,
      data: query.variant === 'persuadeAffinity' ? [RECOMMENDATION] : [],
    }))
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 500,
      data: { message: 'boom' },
    })
    render(
      <SmsFlow
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        preselectedRecommendedVariant="persuadeAffinity"
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue (19,000)' }),
    )

    expect(
      await screen.findByText("We couldn't save this list. Try again."),
    ).toBeInTheDocument()
    expect(screen.getByTestId('recommended-list-card')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(createP2pPhoneList).not.toHaveBeenCalled()
  })
})

describe('SmsFlow — recommended lists', () => {
  it('shows a card and carries its variant through to the created filter', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 19000 } })
    const filterCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return {
        status: 200,
        // gp-api's own diff of the recommendation against what was
        // submitted. The conversion event reports it verbatim, so it is
        // scripted true here rather than left to the default.
        data: { id: 88, name: body.name, recommendedModified: true },
      }
    })
    await openToAudience()

    await screen.findByText('Persuadable independents')
    expect(screen.getByText(/19,000 people/)).toBeInTheDocument()
    expect(screen.getByText(/48% of your vote goal/)).toBeInTheDocument()
    expect(screen.getByText(/\$665\.00 to reach them/)).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('recommended-list-card'))

    // Landed on the name step with the recommendation's title prefilled and
    // still editable — "a candidate must still be able to edit the filter
    // before submitting" (Back reaches the filters step with the same
    // prefilled selection, matching the existing name -> filters Back path).
    expect(await screen.findByText('Name this list')).toBeInTheDocument()
    expect(screen.getByLabelText('List name')).toHaveValue(
      'Persuadable independents',
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )

    expect(filterCalls).toHaveLength(1)
    expect(filterCalls[0]).toMatchObject({
      recommendedVariant: 'persuadeAffinity',
      recommendedChannel: 'sms',
      // The variant's own intent, not the purpose picked to reach it.
      recommendedIntent: 'persuade',
    })

    // Fires only here, after the create response carries gp-api's
    // `recommendedModified` — and it reads state the create callback closes
    // over, so a missing dependency silently drops the event entirely.
    await waitFor(() => expect(acceptedCalls()).toHaveLength(1))
    expect(acceptedCalls()[0]?.[1]).toEqual({
      variant: 'persuadeAffinity',
      channel: 'sms',
      intent: 'persuade',
      count: 19000,
      voteGoalShare: 0.48,
      modified: true,
      reusedExistingList: false,
    })
  })

  it('selects the existing list instead of creating a duplicate', async () => {
    // Overrides the empty default from beforeEach: the recommendation's
    // existingFilterId (501) must resolve against a real saved list, or the
    // picker has nothing to display as "selected".
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 501, name: 'Undecided persuadables' }],
    })
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [EXISTING_RECOMMENDATION],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        demographics: { people: 19000, avgAge: null, avgIncome: null },
        reachability: {
          sms: 15000,
          robocall: null,
          phoneBanking: null,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    const filterCalls: unknown[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      filterCalls.push(body)
      return { status: 200, data: { id: 999, name: 'should not be created' } }
    })
    await openToAudience()

    await userEvent.click(await screen.findByTestId('recommended-list-card'))

    // No name step, no create call — the saved list (id 501) is selected
    // directly and its reachable count resolves.
    expect(screen.queryByText('Name this list')).not.toBeInTheDocument()
    expect(filterCalls).toHaveLength(0)
    expect(await screen.findByText(/Message 15,000 voters/)).toBeInTheDocument()

    // Still an accept, and still measured — this branch bypasses createList,
    // so without its own event the population would be biased to
    // first-time accepts. `reusedExistingList` keeps the two separable.
    expect(acceptedCalls()).toHaveLength(1)
    expect(acceptedCalls()[0]?.[1]).toEqual({
      variant: 'persuadeUndecided',
      channel: 'sms',
      intent: 'persuade',
      count: 19000,
      voteGoalShare: 0.48,
      modified: false,
      reusedExistingList: true,
    })
  })

  // QA (Sep 9): internal accounts have no Peerly identity on their TCR
  // record, so the phone-list upload that follows the create 400s. The
  // create itself had already succeeded under the typed name, but the
  // failure was thrown into the naming drawer, which read it as "We
  // couldn't save this list" — and every retry POSTed a fresh duplicate.
  it('keeps the renamed list and reports the phone-list failure outside the drawer', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 19000 } })
    // Held open on purpose: in production the created list's reachability
    // fetch is still in flight when the phone-list failure lands, so the
    // CTA must read as loading rather than silently disabled until then.
    let releaseListDetail: (() => void) | undefined
    const listDetail = {
      status: 200 as const,
      data: {
        demographics: { people: 19000, avgAge: null, avgIncome: null },
        reachability: {
          sms: 15000,
          robocall: null,
          phoneBanking: null,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    }
    api.mock(
      'GET /v1/contacts/list-detail',
      () =>
        new Promise<typeof listDetail>((resolve) => {
          releaseListDetail = () => resolve(listDetail)
        }),
    )
    const created: { id: number; name: string }[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      const row = { id: 88 + created.length, name: body.name as string }
      created.push(row)
      return { status: 200, data: row }
    })
    api.mock('GET /v1/voters/voter-file/filters', () => ({
      status: 200,
      data: created,
    }))
    vi.mocked(createP2pPhoneList).mockResolvedValueOnce({
      ok: false,
      status: 400,
    })
    await openToAudience()

    await userEvent.click(await screen.findByTestId('recommended-list-card'))
    const input = await screen.findByLabelText('List name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Intro texts, week one')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )

    // The list exists under the typed name and is the selected audience.
    expect(created).toEqual([{ id: 88, name: 'Intro texts, week one' }])
    // vaul keeps a closed drawer mounted in jsdom, so read its state.
    await waitFor(() =>
      expect(
        screen
          .getByText('Name this list')
          .closest('[data-vaul-drawer]')
          ?.getAttribute('data-state'),
      ).toBe('closed'),
    )
    expect(await screen.findByText('Intro texts, week one')).toBeInTheDocument()

    // The failure is the audience step's phone-list error, not a save error.
    expect(
      await screen.findByText("We couldn't prepare this audience. Try again."),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("We couldn't save this list. Try again."),
    ).not.toBeInTheDocument()

    // Retrying re-derives the phone list from the saved row — no duplicate.
    // The closed nested drawer stays mounted in jsdom, so the shell's CTA is
    // still aria-hidden to role queries; find it by text.
    const retry = (await screen.findByText('Try again')).closest('button')
    expect(retry).toBeDisabled()
    expect(retry).toHaveAttribute('data-loading', 'true')
    releaseListDetail?.()
    await waitFor(() => expect(retry).toBeEnabled())
    await userEvent.click(retry as HTMLButtonElement)
    await screen.findByText('When do you want to send it?')
    expect(created).toHaveLength(1)
    expect(vi.mocked(createP2pPhoneList)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createP2pPhoneList).mock.calls[1]?.[1]).toBe(88)
  })

  // The drawer path must reset the phone-list token the way onSelect does.
  // Otherwise a token from a list picked earlier survives the failed upload,
  // and "Try again" short-circuits to schedule with that list's audience.
  it("does not reuse an earlier list's phone list when the drawer upload fails", async () => {
    const LIST_A = { id: 501, name: 'Undecided persuadables' }
    const created: { id: number; name: string }[] = []
    api.mock('GET /v1/voters/voter-file/filters', () => ({
      status: 200,
      data: [LIST_A, ...created],
    }))
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [RECOMMENDATION],
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 19000 } })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        demographics: { people: 19000, avgAge: null, avgIncome: null },
        reachability: {
          sms: 15000,
          robocall: null,
          phoneBanking: null,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      const row = { id: 88, name: body.name as string }
      created.push(row)
      return { status: 200, data: row }
    })
    vi.mocked(createP2pPhoneList)
      .mockResolvedValueOnce({ ok: true, token: 'tok-list-a' })
      .mockResolvedValueOnce({ ok: false, status: 400 })
    await openToAudience()

    // Pick list A and advance, so a phone-list token exists for it.
    await userEvent.click(await screen.findByText('View your lists here'))
    await userEvent.click(await screen.findByText('Undecided persuadables'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue/ }),
    )
    await screen.findByText('When do you want to send it?')
    expect(vi.mocked(createP2pPhoneList).mock.calls[0]?.[1]).toBe(501)

    // Back to the audience, accept the recommendation, upload fails.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(await screen.findByTestId('recommended-list-card'))
    const input = await screen.findByLabelText('List name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Intro texts, week one')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )
    expect(
      await screen.findByText("We couldn't prepare this audience. Try again."),
    ).toBeInTheDocument()

    // Retry must build list B's phone list, not ride list A's token.
    const retry = (await screen.findByText('Try again')).closest('button')
    await waitFor(() => expect(retry).toBeEnabled())
    await userEvent.click(retry as HTMLButtonElement)
    await screen.findByText('When do you want to send it?')
    expect(vi.mocked(createP2pPhoneList)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(createP2pPhoneList).mock.calls[2]?.[1]).toBe(88)
    expect(created).toHaveLength(1)
  })

  it('renders the picker unchanged when there are no recommendations', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    await openToAudience()

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.getByText('Choose a voter list')).toBeInTheDocument()
  })

  it('shows a loading state while counts resolve', async () => {
    // Never resolves for the life of the test — enough to pin the loading
    // node without racing ofetch's own automatic GET retry (500/502/504 are
    // all in its default retryStatusCodes, so a single scripted resolution
    // would only settle the first of two real requests).
    api.mock(
      'GET /v1/campaigns/mine/recommended-lists',
      () => new Promise(() => undefined),
    )
    await openToAudience()

    expect(
      await screen.findByTestId('outreach-audience-loading'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  // The endpoint can also throw a 502/504 on a warehouse outage, deliberately
  // — that must never read as "no recommendations". A static persistent mock
  // (rather than a scripted one-shot resolve) is what's safe against ofetch's
  // automatic GET retry on 5xx: both the original attempt and the retry hit
  // this same handler and both come back 500.
  it('shows an error state distinct from the empty state, on top of the unchanged picker', async () => {
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 500,
      data: { message: 'warehouse outage' },
    })
    await openToAudience()

    expect(
      await screen.findByTestId('recommended-lists-error'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('outreach-audience-loading')).toBeNull()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.getByText('Choose a voter list')).toBeInTheDocument()
  })

  // The flow host stays mounted with `open` never going false between steps,
  // so without an active/mode gate this warehouse-backed query kept
  // refetching on window focus for screens that don't show it at all
  // (schedule/compose/review) — caught by a live reviewer mutation test on
  // the first round, now pinned here.
  it('stops refetching recommendations once the audience step is left behind', async () => {
    let requestCount = 0
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      requestCount += 1
      return { status: 200, data: [] }
    })
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 1, name: 'Likely voters' }],
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        demographics: { people: 100, avgAge: null, avgIncome: null },
        reachability: {
          sms: 90,
          robocall: null,
          phoneBanking: null,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    await openToAudience()
    await waitFor(() => expect(requestCount).toBe(1))

    await userEvent.click(screen.getByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue/ }),
    )
    await screen.findByText('When do you want to send it?')

    window.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(requestCount).toBe(1)
  })
})
