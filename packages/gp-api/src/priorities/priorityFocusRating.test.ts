import { beforeEach, describe, expect, it, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import type { OnboardingFocus } from '@goodparty_org/contracts'
import { CommunityIssueDispatchService } from '@/communityIssues/services/communityIssueDispatch.service'
import { ElectionsService } from '@/elections/services/elections.service'
import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  FirstWinHorizon,
  FocusFactSource,
  PrioritySource,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { useTestService } from '@/test-service'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import { FocusRatingsSchema } from './services/priorityFocusRating.service'

const service = useTestService({ jobs: true })

const START_PATH = '/v1/community-issues/onboarding'
const FOCUS_PATH = '/v1/priorities/onboarding/focus'

let eoId: string
let eoOrgSlug: string

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const searchSpy = () => service.app.get(GeminiService).generateWithSearch
const structuredSpy = () => service.app.get(GeminiService).generateStructured
const dispatchSpy = () =>
  service.app.get(CommunityIssueDispatchService).onElectedOfficeCreated

const getFocus = async () =>
  (await service.client.get<OnboardingFocus>(FOCUS_PATH, eoHeaders())).data

const RATINGS = {
  ratings: [
    {
      id: 'p1',
      resident_interest: 'high',
      resident_interest_basis: 'local_sources',
      first_win: 'weeks',
      first_win_basis: 'local_sources',
      source_urls: ['https://news.example.com/day-avenue-petition'],
      recap_line: 'slowing the traffic on Day Avenue.',
    },
    {
      id: 'p2',
      resident_interest: 'low',
      // Claims a source it never names: recorded as an estimate.
      resident_interest_basis: 'local_sources',
      first_win: 'year_or_more',
      first_win_basis: 'estimate',
      source_urls: [],
      recap_line: 'housing people can afford',
    },
  ],
}

const NO_STARTER_ISSUES = { issues: [] }

const createOffice = async (
  customIssues: { title: string; position: string }[] | null,
) => {
  eoId = uuidv7()
  eoOrgSlug = `eo-${eoId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  const campaignSlug = `campaign-${uuidv7()}`
  await service.prisma.organization.create({
    data: { slug: campaignSlug, ownerId: service.user.id },
  })
  const campaign = customIssues
    ? await service.prisma.campaign.create({
        data: {
          slug: campaignSlug,
          userId: service.user.id,
          organizationSlug: campaignSlug,
          details: { customIssues },
        },
      })
    : null
  await service.prisma.electedOffice.create({
    data: {
      id: eoId,
      userId: service.user.id,
      organizationSlug: eoOrgSlug,
      campaignId: campaign?.id,
    },
  })
}

const RAN_ON = [
  {
    title: 'Slow the traffic on Day Avenue',
    position: 'Day Avenue is a cut-through past the school.',
  },
  {
    title: 'More housing people can afford',
    position: 'We need homes a teacher can afford.',
  },
]

// A top list that already carries a first win, so the starter search is
// skipped and every Gemini call in the test is the rating's.
const createRatedIssue = () =>
  service.prisma.communityIssue.create({
    data: {
      organizationSlug: eoOrgSlug,
      list: CommunityIssueList.top_community,
      category: CommunityIssueCategory.quality_of_life,
      priority: CommunityIssuePriority.high,
      title: 'The flyering ordinance',
      summary: 'A temporary amendment went to the council.',
      rank: 1,
      firstWin: FirstWinHorizon.weeks,
      firstWinSource: FocusFactSource.local_sources,
    },
  })

const ranOnRows = () =>
  service.prisma.priority.findMany({
    where: { electedOfficeId: eoId, source: PrioritySource.win_import },
    orderBy: { createdAt: 'asc' },
  })

beforeEach(() => {
  const organizations = service.app.get(OrganizationsService)
  vi.spyOn(organizations, 'resolveServeContext').mockResolvedValue({
    state: 'MA',
    positionName: 'Northampton City Council',
    l2DistrictName: 'Northampton',
  })
  vi.spyOn(organizations, 'getDistrictAndLevelForOrgSlug').mockResolvedValue({
    district: {
      id: 'district-1',
      state: 'MA',
      l2Type: 'City',
      l2Name: 'Northampton',
    },
    level: 'local',
  })
  vi.spyOn(
    service.app.get(ElectionsService),
    'getVoterIssues',
  ).mockResolvedValue([
    { label: 'Traffic safety', score: 71, priority: 'high' },
    { label: 'Housing costs', score: 64, priority: 'high' },
  ])
  const gemini = service.app.get(GeminiService)
  vi.spyOn(gemini, 'generateWithSearch').mockResolvedValue({
    text: 'search results',
    searchQueries: [],
    sources: [],
  })
  vi.spyOn(gemini, 'generateStructured').mockImplementation((_prompt, schema) =>
    Promise.resolve(
      schema.parse(
        Object.is(schema, FocusRatingsSchema) ? RATINGS : NO_STARTER_ISSUES,
      ),
    ),
  )
  vi.spyOn(
    service.app.get(CommunityIssueDispatchService),
    'onElectedOfficeCreated',
  ).mockResolvedValue(undefined)
})

describe('rating what a winner ran on', () => {
  it('stores both facts, where each came from, and a recap phrase', async () => {
    await createOffice(RAN_ON)
    await createRatedIssue()

    await service.client.post(START_PATH, {}, eoHeaders())
    await service.jobs.settle()

    expect(await ranOnRows()).toMatchObject([
      {
        title: 'Slow the traffic on Day Avenue',
        residentInterest: 'high',
        residentInterestSource: 'local_sources',
        firstWin: 'weeks',
        firstWinSource: 'local_sources',
        recapLine: 'slowing the traffic on Day Avenue',
      },
      {
        title: 'More housing people can afford',
        residentInterest: 'low',
        residentInterestSource: 'estimate',
        firstWin: 'year_or_more',
        firstWinSource: 'estimate',
        recapLine: 'housing people can afford',
      },
    ])

    const prompt = vi.mocked(searchSpy()).mock.calls[0]?.[0] ?? ''
    expect(prompt).toContain(
      '<issue id="p1"><title>Slow the traffic on Day Avenue</title>',
    )
    expect(prompt).toContain('Traffic safety; Housing costs')
    expect(prompt).not.toContain('71')

    const focus = await getFocus()
    expect(focus.searchPending).toBe(false)
    expect(
      focus.options.map(({ title, residentInterest, firstWin, recapLine }) => ({
        title,
        residentInterest,
        firstWin,
        recapLine,
      })),
    ).toEqual([
      {
        title: 'Slow the traffic on Day Avenue',
        residentInterest: 'high',
        firstWin: 'weeks',
        recapLine: 'slowing the traffic on Day Avenue',
      },
      {
        title: 'More housing people can afford',
        residentInterest: 'low',
        firstWin: 'year_or_more',
        recapLine: 'housing people can afford',
      },
      {
        title: 'The flyering ordinance',
        residentInterest: 'high',
        firstWin: 'weeks',
        recapLine: 'The flyering ordinance',
      },
    ])
    expect(dispatchSpy()).toHaveBeenCalledTimes(1)
  })

  it('shows the fallback while the search runs, then the real values', async () => {
    await createOffice(RAN_ON)
    await createRatedIssue()
    let releaseSearch: () => void = () => undefined
    const searchHeld = new Promise<void>((resolve) => {
      releaseSearch = resolve
    })
    vi.mocked(searchSpy()).mockImplementation(async () => {
      await searchHeld
      return { text: 'search results', searchQueries: [], sources: [] }
    })

    await service.client.post(START_PATH, {}, eoHeaders())
    await vi.waitFor(() => expect(searchSpy()).toHaveBeenCalled())

    const during = await getFocus()
    expect(during.searchPending).toBe(true)
    expect(during.options[0]).toMatchObject({
      title: 'Slow the traffic on Day Avenue',
      residentInterest: 'medium',
      firstWin: 'months',
      recapLine: 'Slow the traffic on Day Avenue',
    })

    releaseSearch()
    await service.jobs.settle()

    const after = await getFocus()
    expect(after.searchPending).toBe(false)
    expect(after.options[0]).toMatchObject({
      residentInterest: 'high',
      firstWin: 'weeks',
      recapLine: 'slowing the traffic on Day Avenue',
    })
  })

  it('keeps the fallback when the search fails and rates on the next attempt', async () => {
    await createOffice(RAN_ON)
    await createRatedIssue()
    vi.mocked(searchSpy()).mockRejectedValueOnce(new Error('Gemini down'))
    // A failed dispatch is what makes the job run again. It runs after the
    // failed search, so what it reads is what an official would be shown.
    let afterFailedSearch: OnboardingFocus | null = null
    vi.mocked(dispatchSpy()).mockImplementationOnce(async () => {
      afterFailedSearch = await getFocus()
      throw new Error('dispatch failed')
    })

    await service.client.post(START_PATH, {}, eoHeaders())
    await service.jobs.settle()

    expect(afterFailedSearch).toMatchObject({
      options: [
        {
          title: 'Slow the traffic on Day Avenue',
          residentInterest: 'medium',
          firstWin: 'months',
          recapLine: 'Slow the traffic on Day Avenue',
        },
        {
          title: 'More housing people can afford',
          residentInterest: 'medium',
          firstWin: 'months',
          recapLine: 'More housing people can afford',
        },
        { title: 'The flyering ordinance' },
      ],
    })
    expect(dispatchSpy()).toHaveBeenCalledTimes(2)
    expect(searchSpy()).toHaveBeenCalledTimes(2)
    expect((await getFocus()).options[0]).toMatchObject({
      residentInterest: 'high',
      firstWin: 'weeks',
    })
  })

  it('places a top community issue that has no first win yet', async () => {
    await createOffice([])
    const issue = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: eoOrgSlug,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.health_and_human_services,
        priority: CommunityIssuePriority.medium,
        title: 'The nicotine policy',
        summary: 'The Board of Health held a hearing.',
        rank: 1,
        lastRefreshedRunId: 'run-1',
      },
    })
    vi.mocked(structuredSpy()).mockResolvedValue({
      ratings: [
        {
          id: 'c1',
          resident_interest: 'high',
          resident_interest_basis: 'estimate',
          first_win: 'months',
          first_win_basis: 'local_sources',
          source_urls: ['https://news.example.com/nicotine-hearing'],
          recap_line: 'the nicotine policy',
        },
      ],
    })

    await service.client.post(START_PATH, {}, eoHeaders())
    await service.jobs.settle()

    expect(
      await service.prisma.communityIssue.findUniqueOrThrow({
        where: { id: issue.id },
      }),
    ).toMatchObject({
      priority: CommunityIssuePriority.medium,
      firstWin: 'months',
      firstWinSource: 'local_sources',
      recapLine: 'the nicotine policy',
    })
    expect((await getFocus()).options).toEqual([
      {
        key: issue.id,
        kind: 'community',
        title: 'The nicotine policy',
        description: 'The Board of Health held a hearing.',
        residentInterest: 'medium',
        firstWin: 'months',
        recapLine: 'the nicotine policy',
      },
    ])
  })

  it('searches once: a second start finds nothing left to rate', async () => {
    await createOffice(RAN_ON)
    await createRatedIssue()

    await service.client.post(START_PATH, {}, eoHeaders())
    await service.jobs.settle()
    await service.prisma.$executeRaw`
      DELETE FROM pgboss.job WHERE name = 'communityIssueOnboarding'`
    await service.client.post(START_PATH, {}, eoHeaders())
    await service.jobs.settle()

    expect(dispatchSpy()).toHaveBeenCalledTimes(2)
    expect(searchSpy()).toHaveBeenCalledTimes(1)
  })

  it('does not search for an office that did not come from a win', async () => {
    await createOffice(null)
    await createRatedIssue()
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Library hours',
        description: 'Open on Sundays',
        source: PrioritySource.user_stated,
      },
    })

    await service.client.post(START_PATH, {}, eoHeaders())
    await service.jobs.settle()

    expect(searchSpy()).not.toHaveBeenCalled()
    expect(dispatchSpy()).toHaveBeenCalledTimes(1)
    expect((await getFocus()).options[0]).toMatchObject({
      title: 'Library hours',
      residentInterest: 'medium',
      firstWin: 'months',
    })
  })
})
