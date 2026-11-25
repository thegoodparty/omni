import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import type {
  OnboardingFocus,
  Priority,
  SetOnboardingFocusResult,
} from '@goodparty_org/contracts'
import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  FirstWinHorizon,
  FocusFactSource,
  PrioritySource,
  ResidentInterest,
} from '@/generated/prisma'
import { PriorityFocusService } from './services/priorityFocus.service'

const service = useTestService()

const PATH = '/v1/priorities/onboarding/focus'

let eoId: string
let eoOrgSlug: string

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const getFocus = async () =>
  (await service.client.get<OnboardingFocus>(PATH, eoHeaders())).data

const putFocus = (shownKeys: string[], focusKey: string) =>
  service.client.put<SetOnboardingFocusResult>(
    PATH,
    { shownKeys, focusKey },
    eoHeaders(),
  )

const createIssue = (
  title: string,
  rank: number,
  facts: {
    priority?: CommunityIssuePriority
    firstWin?: FirstWinHorizon
    recapLine?: string
  } = {},
) =>
  service.prisma.communityIssue.create({
    data: {
      organizationSlug: eoOrgSlug,
      list: CommunityIssueList.top_community,
      category: CommunityIssueCategory.housing_and_development,
      priority: facts.priority ?? CommunityIssuePriority.medium,
      title,
      summary: `${title} summary. A second sentence.`,
      rank,
      firstWin: facts.firstWin ?? null,
      firstWinSource: facts.firstWin ? FocusFactSource.local_sources : null,
      recapLine: facts.recapLine ?? null,
    },
  })

const createRanOn = (
  title: string,
  minute: number,
  facts: {
    residentInterest?: ResidentInterest
    firstWin?: FirstWinHorizon
    recapLine?: string
  } = {},
) =>
  service.prisma.priority.create({
    data: {
      electedOfficeId: eoId,
      title,
      description: `${title} description.`,
      source: PrioritySource.win_import,
      createdAt: new Date(Date.UTC(2026, 10, 1, 12, minute)),
      residentInterest: facts.residentInterest ?? null,
      residentInterestSource: facts.residentInterest
        ? FocusFactSource.estimate
        : null,
      firstWin: facts.firstWin ?? null,
      firstWinSource: facts.firstWin ? FocusFactSource.estimate : null,
      recapLine: facts.recapLine ?? null,
    },
  })

const createOffice = async (campaignId?: number) => {
  eoId = uuidv7()
  eoOrgSlug = `eo-${eoId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: {
      id: eoId,
      userId: service.user.id,
      organizationSlug: eoOrgSlug,
      campaignId,
    },
  })
}

const activePriorities = () =>
  service.prisma.priority.findMany({
    where: { electedOfficeId: eoId, archivedAt: null },
    orderBy: { title: 'asc' },
  })

beforeEach(async () => {
  await createOffice()
})

describe('welcome focus cards', () => {
  it('shows every issue they ran on and no community issue when there are three', async () => {
    await createRanOn('Slow the traffic on Day Avenue', 1, {
      residentInterest: ResidentInterest.high,
      firstWin: FirstWinHorizon.weeks,
      recapLine: 'slowing the traffic on Day Avenue',
    })
    await createRanOn('Keep Forbes Library open on Sundays', 2)
    await createRanOn('More housing people can afford', 3)
    await createRanOn('Fix the sidewalks', 4)
    await createIssue('Picture Main Street', 1)

    const focus = await getFocus()

    expect(focus.kind).toBe('ran_on')
    expect(focus.searchPending).toBe(false)
    expect(focus.saved).toBeNull()
    expect(focus.options.map(({ kind, title }) => ({ kind, title }))).toEqual([
      { kind: 'ran_on', title: 'Slow the traffic on Day Avenue' },
      { kind: 'ran_on', title: 'Keep Forbes Library open on Sundays' },
      { kind: 'ran_on', title: 'More housing people can afford' },
      { kind: 'ran_on', title: 'Fix the sidewalks' },
    ])
    expect(focus.options[0]).toMatchObject({
      description: 'Slow the traffic on Day Avenue description.',
      residentInterest: 'high',
      firstWin: 'weeks',
      recapLine: 'slowing the traffic on Day Avenue',
    })
  })

  it('shows the top three community issues when they ran on nothing', async () => {
    await createIssue('Noise', 4)
    const top = await createIssue('Picture Main Street', 1, {
      priority: CommunityIssuePriority.high,
      firstWin: FirstWinHorizon.year_or_more,
      recapLine: 'Picture Main Street',
    })
    await createIssue('The divestment lawsuit', 2)
    await createIssue('The flyering ordinance', 3)

    const focus = await getFocus()

    expect(focus.kind).toBe('community')
    expect(focus.options.map((option) => option.title)).toEqual([
      'Picture Main Street',
      'The divestment lawsuit',
      'The flyering ordinance',
    ])
    expect(focus.options[0]).toEqual({
      key: top.id,
      kind: 'community',
      title: 'Picture Main Street',
      description: 'Picture Main Street summary.',
      residentInterest: 'high',
      firstWin: 'year_or_more',
      recapLine: 'Picture Main Street',
    })
  })

  it('fills up to three with community issues when they ran on fewer', async () => {
    await createRanOn('Slow the traffic on Day Avenue', 1)
    await createIssue('Picture Main Street', 1)
    await createIssue('The divestment lawsuit', 2)
    await createIssue('The flyering ordinance', 3)

    const focus = await getFocus()

    expect(focus.kind).toBe('mixed')
    expect(focus.options.map(({ kind, title }) => ({ kind, title }))).toEqual([
      { kind: 'ran_on', title: 'Slow the traffic on Day Avenue' },
      { kind: 'community', title: 'Picture Main Street' },
      { kind: 'community', title: 'The divestment lawsuit' },
    ])
  })

  it('answers with no cards when there is nothing to offer', async () => {
    const focus = await getFocus()

    expect(focus).toEqual({
      kind: 'community',
      options: [],
      searchPending: false,
      saved: null,
    })
  })

  it('gives the last slot to a quick win ranked below the top three', async () => {
    const high = CommunityIssuePriority.high
    await createIssue('Picture Main Street', 1, {
      priority: high,
      firstWin: FirstWinHorizon.year_or_more,
    })
    await createIssue('The divestment lawsuit', 2, {
      priority: high,
      firstWin: FirstWinHorizon.year_or_more,
    })
    await createIssue('The weapons manufacturing ban', 3, {
      firstWin: FirstWinHorizon.weeks,
    })
    await createIssue('The nicotine policy', 4, {
      priority: high,
      firstWin: FirstWinHorizon.months,
    })
    await createIssue('The flyering ordinance', 5, {
      priority: high,
      firstWin: FirstWinHorizon.weeks,
    })

    const focus = await getFocus()

    expect(focus.options.map((option) => option.title)).toEqual([
      'Picture Main Street',
      'The divestment lawsuit',
      'The flyering ordinance',
    ])
  })

  it('keeps rank order when a ran-on card is already a quick win', async () => {
    await createRanOn('Slow the traffic on Day Avenue', 1, {
      residentInterest: ResidentInterest.high,
      firstWin: FirstWinHorizon.months,
    })
    await createIssue('Picture Main Street', 1, {
      priority: CommunityIssuePriority.high,
      firstWin: FirstWinHorizon.year_or_more,
    })
    await createIssue('The divestment lawsuit', 2)
    await createIssue('The flyering ordinance', 3, {
      priority: CommunityIssuePriority.high,
      firstWin: FirstWinHorizon.weeks,
    })

    const focus = await getFocus()

    expect(focus.options.map((option) => option.title)).toEqual([
      'Slow the traffic on Day Avenue',
      'Picture Main Street',
      'The divestment lawsuit',
    ])
  })

  it('swaps in a quick win beside a ran-on card that is not one', async () => {
    await createRanOn('More housing people can afford', 1, {
      residentInterest: ResidentInterest.high,
      firstWin: FirstWinHorizon.year_or_more,
    })
    await createIssue('Picture Main Street', 1)
    await createIssue('The divestment lawsuit', 2)
    await createIssue('The flyering ordinance', 3, {
      priority: CommunityIssuePriority.high,
      firstWin: FirstWinHorizon.weeks,
    })

    const focus = await getFocus()

    expect(focus.options.map((option) => option.title)).toEqual([
      'More housing people can afford',
      'Picture Main Street',
      'The flyering ordinance',
    ])
  })

  it('never leaves a fact blank before the search has rated a card', async () => {
    await createRanOn('Slow the traffic on Day Avenue', 1)
    await createIssue('Picture Main Street', 1, {
      priority: CommunityIssuePriority.high,
    })
    await createIssue('The flyering ordinance', 2, {
      priority: CommunityIssuePriority.low,
    })
    await createIssue('The nicotine policy', 3, {
      priority: CommunityIssuePriority.high,
    })

    const focus = await getFocus()

    expect(
      focus.options.map(({ residentInterest, firstWin, recapLine }) => ({
        residentInterest,
        firstWin,
        recapLine,
      })),
    ).toEqual([
      {
        residentInterest: 'medium',
        firstWin: 'months',
        recapLine: 'Slow the traffic on Day Avenue',
      },
      {
        residentInterest: 'high',
        firstWin: 'months',
        recapLine: 'Picture Main Street',
      },
      {
        residentInterest: 'low',
        firstWin: 'months',
        recapLine: 'The flyering ordinance',
      },
    ])
  })
})

describe('what a winner ran on carries over', () => {
  it('copies every picked position, then every typed issue', async () => {
    const slug = `campaign-${uuidv7()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        slug,
        userId: service.user.id,
        organizationSlug: slug,
        details: {
          customIssues: [
            {
              title: 'More housing people can afford',
              position: 'We need homes a teacher can afford.',
            },
          ],
        },
      },
    })
    const library = await service.prisma.position.create({
      data: { name: 'Keep Forbes Library open on Sundays' },
    })
    const traffic = await service.prisma.position.create({
      data: { name: 'Slow the traffic on Day Avenue' },
    })
    await service.prisma.campaignPosition.create({
      data: {
        campaignId: campaign.id,
        positionId: library.id,
        description: 'Sunday hours were cut.',
        createdAt: new Date('2026-03-02T15:06:00Z'),
      },
    })
    await service.prisma.campaignPosition.create({
      data: {
        campaignId: campaign.id,
        positionId: traffic.id,
        description: 'Day Avenue is a cut-through.',
        createdAt: new Date('2026-03-02T15:04:00Z'),
      },
    })
    await createOffice(campaign.id)

    const focus = await getFocus()

    expect(focus.kind).toBe('ran_on')
    expect(
      focus.options.map(({ title, description }) => ({ title, description })),
    ).toEqual([
      {
        title: 'Slow the traffic on Day Avenue',
        description: 'Day Avenue is a cut-through.',
      },
      {
        title: 'Keep Forbes Library open on Sundays',
        description: 'Sunday hours were cut.',
      },
      {
        title: 'More housing people can afford',
        description: 'We need homes a teacher can afford.',
      },
    ])

    await getFocus()
    expect(await activePriorities()).toHaveLength(3)
  })

  it('adds the positions an earlier seed left out, and keeps a removed issue removed', async () => {
    const slug = `campaign-${uuidv7()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        slug,
        userId: service.user.id,
        organizationSlug: slug,
        details: {
          customIssues: [
            { title: 'More housing people can afford', position: 'Homes.' },
          ],
        },
      },
    })
    const traffic = await service.prisma.position.create({
      data: { name: 'Slow the traffic on Day Avenue' },
    })
    await service.prisma.campaignPosition.create({
      data: { campaignId: campaign.id, positionId: traffic.id },
    })
    await createOffice(campaign.id)
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'More housing people can afford',
        description: 'Homes.',
        source: PrioritySource.win_import,
        archivedAt: new Date(),
      },
    })

    const focus = await getFocus()

    expect(focus.options.map((option) => option.title)).toEqual([
      'Slow the traffic on Day Avenue',
    ])
  })
})

describe('saving the focus', () => {
  it('turns a picked community issue into the first focus and keeps the rest', async () => {
    const ranOn = await createRanOn('Slow the traffic on Day Avenue', 1)
    const flyers = await createIssue('The flyering ordinance', 1, {
      priority: CommunityIssuePriority.high,
      firstWin: FirstWinHorizon.weeks,
      recapLine: 'the flyering ordinance',
    })
    const mainStreet = await createIssue('Picture Main Street', 2)
    const shown = (await getFocus()).options.map((option) => option.key)
    expect(shown).toEqual([ranOn.id, flyers.id, mainStreet.id])

    const res = await putFocus(shown, flyers.id)

    expect(res.status).toBe(HttpStatus.OK)
    const created = await service.prisma.priority.findFirstOrThrow({
      where: { sourceCommunityIssueId: flyers.id },
    })
    expect(res.data).toEqual({
      priorityId: created.id,
      title: 'The flyering ordinance',
      recapLine: 'the flyering ordinance',
    })
    expect(created).toMatchObject({
      source: PrioritySource.community_issue,
      residentInterest: ResidentInterest.high,
      residentInterestSource: FocusFactSource.local_sources,
      firstWin: FirstWinHorizon.weeks,
      firstWinSource: FocusFactSource.local_sources,
      recapLine: 'the flyering ordinance',
    })
    expect(created.focusedAt).not.toBeNull()

    expect((await activePriorities()).map((row) => row.title)).toEqual([
      'Slow the traffic on Day Avenue',
      'The flyering ordinance',
    ])
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: eoOrgSlug, archivedAt: null },
      }),
    ).toBe(2)

    const list = await service.client.get<Priority[]>(
      '/v1/priorities',
      eoHeaders(),
    )
    expect(list.data.map((row) => row.title)).toEqual([
      'The flyering ordinance',
      'Slow the traffic on Day Avenue',
    ])

    const after = await getFocus()
    expect(after.options.map((option) => option.key)).toEqual(shown)
    expect(after.saved).toEqual({
      focusKey: flyers.id,
      priorityId: created.id,
      title: 'The flyering ordinance',
      recapLine: 'the flyering ordinance',
      pickedAt: expect.any(String),
      shown: [
        {
          key: ranOn.id,
          kind: 'ran_on',
          title: 'Slow the traffic on Day Avenue',
          residentInterest: 'medium',
          firstWin: 'months',
          picked: false,
        },
        {
          key: flyers.id,
          kind: 'community',
          title: 'The flyering ordinance',
          residentInterest: 'high',
          firstWin: 'weeks',
          picked: true,
        },
        {
          key: mainStreet.id,
          kind: 'community',
          title: 'Picture Main Street',
          residentInterest: 'medium',
          firstWin: 'months',
          picked: false,
        },
      ],
    })
  })

  it('keeps what was shown readable by other modules, sources included', async () => {
    const ranOn = await createRanOn('Slow the traffic on Day Avenue', 1, {
      residentInterest: ResidentInterest.low,
      firstWin: FirstWinHorizon.weeks,
    })
    const mainStreet = await createIssue('Picture Main Street', 1)

    await putFocus([ranOn.id, mainStreet.id], ranOn.id)

    const saved = await service.app.get(PriorityFocusService).savedFor(eoId)
    expect(saved).toMatchObject({
      electedOfficeId: eoId,
      priorityId: ranOn.id,
      priorityActivated: false,
    })
    expect(saved?.pickedAt).toBeInstanceOf(Date)
    expect(saved?.options).toMatchObject([
      {
        position: 0,
        key: ranOn.id,
        kind: 'ran_on',
        residentInterest: 'low',
        residentInterestSource: 'estimate',
        firstWin: 'weeks',
        firstWinSource: 'estimate',
        picked: true,
      },
      {
        position: 1,
        key: mainStreet.id,
        kind: 'community',
        residentInterest: 'medium',
        residentInterestSource: 'local_sources',
        firstWin: 'months',
        firstWinSource: 'default',
        picked: false,
      },
    ])
  })

  it('moves the focus on a second save and archives the priority the first one made', async () => {
    const ranOn = await createRanOn('Slow the traffic on Day Avenue', 1)
    const flyers = await createIssue('The flyering ordinance', 1)
    const mainStreet = await createIssue('Picture Main Street', 2)
    const shown = [ranOn.id, flyers.id, mainStreet.id]

    await putFocus(shown, flyers.id)
    const second = await putFocus(shown, ranOn.id)

    expect(second.data).toEqual({
      priorityId: ranOn.id,
      title: 'Slow the traffic on Day Avenue',
      recapLine: 'Slow the traffic on Day Avenue',
    })
    const fromIssue = await service.prisma.priority.findFirstOrThrow({
      where: { sourceCommunityIssueId: flyers.id },
    })
    expect(fromIssue.archivedAt).not.toBeNull()
    expect(fromIssue.focusedAt).toBeNull()
    const focused = await service.prisma.priority.findMany({
      where: { electedOfficeId: eoId, focusedAt: { not: null } },
    })
    expect(focused.map((row) => row.id)).toEqual([ranOn.id])
    expect((await getFocus()).saved).toMatchObject({
      focusKey: ranOn.id,
      priorityId: ranOn.id,
    })

    const third = await putFocus(shown, mainStreet.id)
    const fromMainStreet = await service.prisma.priority.findFirstOrThrow({
      where: { sourceCommunityIssueId: mainStreet.id },
    })
    expect(third.data.priorityId).toBe(fromMainStreet.id)
    expect((await activePriorities()).map((row) => row.title)).toEqual([
      'Picture Main Street',
      'Slow the traffic on Day Avenue',
    ])

    const fourth = await putFocus(shown, flyers.id)
    expect(fourth.data.priorityId).toBe(fromIssue.id)
    expect((await activePriorities()).map((row) => row.title)).toEqual([
      'Slow the traffic on Day Avenue',
      'The flyering ordinance',
    ])
    expect(
      await service.prisma.priorityFocusChoice.count({
        where: { electedOfficeId: eoId },
      }),
    ).toBe(1)
  })

  it('leaves alone a priority that was already live before the pick', async () => {
    const flyers = await createIssue('The flyering ordinance', 1)
    const mainStreet = await createIssue('Picture Main Street', 2)
    const existing = await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'The flyering ordinance',
        description: 'Prioritized earlier.',
        source: PrioritySource.community_issue,
        sourceCommunityIssueId: flyers.id,
      },
    })
    const shown = [flyers.id, mainStreet.id]

    const first = await putFocus(shown, flyers.id)
    await putFocus(shown, flyers.id)
    await putFocus(shown, mainStreet.id)

    expect(first.data.priorityId).toBe(existing.id)
    expect((await activePriorities()).map((row) => row.title)).toEqual([
      'Picture Main Street',
      'The flyering ordinance',
    ])
  })

  it('refuses a focus that was not among the cards shown', async () => {
    const flyers = await createIssue('The flyering ordinance', 1)
    const mainStreet = await createIssue('Picture Main Street', 2)

    const res = await putFocus([flyers.id], mainStreet.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await activePriorities()).toEqual([])
  })

  it('refuses a card that is not the office own', async () => {
    const flyers = await createIssue('The flyering ordinance', 1)
    const otherOfficeId = uuidv7()
    const otherSlug = `eo-${otherOfficeId}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const foreign = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: otherSlug,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.other,
        priority: CommunityIssuePriority.high,
        title: 'Another town',
        summary: 'Not theirs.',
        rank: 1,
      },
    })

    const res = await putFocus([flyers.id, foreign.id], foreign.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await activePriorities()).toEqual([])
    expect((await getFocus()).saved).toBeNull()
  })
})
