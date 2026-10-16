import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, subDays } from 'date-fns'
import {
  CivicPanelBuildChannel,
  CivicPanelBuildPlanStatus,
  DashboardCardType,
  OutreachStatus,
  OutreachType,
  PrioritySource,
} from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import type { DashboardCardsResponse } from '@goodparty_org/contracts'

const service = useTestService()

const isFeatureEnabled = vi.fn()

beforeEach(() => {
  isFeatureEnabled.mockReset().mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
})

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const seedPriority = (electedOfficeId: string, title: string) =>
  service.prisma.priority.create({
    data: {
      electedOfficeId,
      title,
      description: `${title}, described.`,
      source: PrioritySource.user_stated,
    },
  })

const seedText = (
  organizationSlug: string,
  status: OutreachStatus,
  asksToJoinCivicPanel = true,
) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug,
      campaignId: null,
      outreachType: OutreachType.text,
      status,
      asksToJoinCivicPanel,
      message: 'Hi, this is Alex.',
    },
  })

const listCards = async (orgSlug: string, bucket = 'active') => {
  const res = await service.client.get<DashboardCardsResponse>(
    `/v1/dashboard/cards?bucket=${bucket}`,
    { headers: { 'x-organization-slug': orgSlug } },
  )
  expect(res.status).toBe(200)
  return res.data.cards
}

const panelRows = (electedOfficeId: string) =>
  service.prisma.dashboardCard.findMany({
    where: { electedOfficeId, type: DashboardCardType.civic_panel },
    orderBy: { title: 'asc' },
  })

const act = async (
  orgSlug: string,
  id: string,
  action: 'complete' | 'dismiss' | 'snooze' | 'restore',
) => {
  const res = await service.client.put(
    `/v1/dashboard/cards/${id}/${action}`,
    null,
    { headers: { 'x-organization-slug': orgSlug } },
  )
  expect(res.status).toBe(204)
}

const titles = (cards: { title: string }[]) =>
  cards.map((card) => card.title).sort()

const buildCard = {
  type: 'civic_panel',
  title: 'Start with the people you represent',
  ctaLabel: 'Build my panel',
  ctaHref: '/dashboard/contacts/citizens-panel',
}

describe('GET /v1/dashboard/cards: the civic panel build card', () => {
  it('starts an office on one build card, with a card per priority beside it', async () => {
    const eo = await seedElectedOffice('eo-civic-build-first')
    const housing = await seedPriority(eo.id, 'Affordable housing')

    const cards = await listCards('eo-civic-build-first')

    expect(titles(cards)).toEqual(
      [buildCard.title, 'Affordable housing'].sort(),
    )
    const build = cards.find((card) => card.title === buildCard.title)
    expect(build).toMatchObject({
      ...buildCard,
      sourceExternalId: `build:${eo.id}`,
      completedAt: null,
    })
    expect(build?.summary).toBe(
      'A civic panel is a group of residents who agree to tell you what ' +
        'they think before you decide.',
    )
    expect(build?.summary.split(' ').length).toBeLessThanOrEqual(20)
    expect(
      cards.find((card) => card.title === 'Affordable housing'),
    ).toMatchObject({
      type: 'civic_panel',
      // A priority with no status yet: the page's badge shows its first step.
      summary: 'The problem',
      ctaLabel: 'Open priority',
      ctaHref: `/dashboard/priorities/${housing.id}`,
    })
  })

  // Its button used to drop the official into the outreach page with no
  // context. It now opens the Chief of Staff chat on the home, so a card
  // made with the old link follows on the next read.
  it("moves a card made with the outreach link onto the home's chat", async () => {
    const eo = await seedElectedOffice('eo-civic-build-relink')
    await listCards('eo-civic-build-relink')
    await service.prisma.dashboardCard.updateMany({
      where: { electedOfficeId: eo.id, type: DashboardCardType.civic_panel },
      data: {
        ctaHref:
          '/dashboard/constituent-outreach?compose=text&purpose=build_citizens_panel',
      },
    })

    const cards = await listCards('eo-civic-build-relink')

    expect(cards).toHaveLength(1)
    expect(cards[0]?.ctaHref).toBe(buildCard.ctaHref)
  })

  it('makes no second build card on a repeat read', async () => {
    const eo = await seedElectedOffice('eo-civic-build-idempotent')

    await Promise.all([
      listCards('eo-civic-build-idempotent'),
      listCards('eo-civic-build-idempotent', 'this_week'),
    ])
    await listCards('eo-civic-build-idempotent')

    expect(await panelRows(eo.id)).toHaveLength(1)
  })

  it('stays open while the panel text is unpaid, or never asked to join', async () => {
    await seedElectedOffice('eo-civic-build-unpaid')
    await seedText('eo-civic-build-unpaid', OutreachStatus.pending_payment)
    await seedText('eo-civic-build-unpaid', OutreachStatus.pending, false)

    const cards = await listCards('eo-civic-build-unpaid')

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ ...buildCard, completedAt: null })
  })

  it('is done once a text asking to join is paid, and the priority cards stay', async () => {
    const eo = await seedElectedOffice('eo-civic-build-sent')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-build-sent')
    await seedText('eo-civic-build-sent', OutreachStatus.pending)

    const active = await listCards('eo-civic-build-sent')
    const done = await listCards('eo-civic-build-sent', 'done')

    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({
      type: 'civic_panel',
      title: 'Affordable housing',
      sourceExternalId: housing.id,
    })
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject(buildCard)
  })

  it('cannot be marked done; only a sent panel text finishes it', async () => {
    const orgSlug = 'eo-civic-build-no-complete'
    const eo = await seedElectedOffice(orgSlug)
    const [build] = await listCards(orgSlug)
    if (!build) throw new Error('no card')

    await act(orgSlug, build.id, 'complete')

    const [row] = await panelRows(eo.id)
    expect(row?.completedAt).toBeNull()
    expect(await listCards(orgSlug)).toHaveLength(1)

    await seedText(orgSlug, OutreachStatus.pending)
    await listCards(orgSlug)

    const [sent] = await panelRows(eo.id)
    expect(sent?.completedAt).not.toBeNull()
  })

  it('counts a skipped build card as done once the text goes out', async () => {
    const eo = await seedElectedOffice('eo-civic-build-skipped')
    await listCards('eo-civic-build-skipped')
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { dismissedAt: new Date() },
    })
    await seedText('eo-civic-build-skipped', OutreachStatus.completed)

    await listCards('eo-civic-build-skipped')

    const [after] = await panelRows(eo.id)
    expect(after?.completedAt).not.toBeNull()
    expect(after?.dismissedAt).toBeNull()
  })

  it('gives a done build card the current title, and keeps it done', async () => {
    const orgSlug = 'eo-civic-build-done-renamed'
    const eo = await seedElectedOffice(orgSlug)
    await listCards(orgSlug)
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    const completedAt = subDays(new Date(), 5)
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { title: "Build your citizens' panel", completedAt },
    })

    await listCards(orgSlug)

    const [after] = await panelRows(eo.id)
    expect(after).toMatchObject({
      title: buildCard.title,
      completedAt,
      dueDate: card.dueDate,
    })
  })

  it('rewrites an open build card still holding the old words', async () => {
    const orgSlug = 'eo-civic-build-old-words'
    const eo = await seedElectedOffice(orgSlug)
    await listCards(orgSlug)
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: {
        title: 'Hear from more than the loudest voices',
        summary:
          'Decisions land better when you know what the whole community ' +
          'thinks, not only who shows up.',
        ctaLabel: 'Get started',
      },
    })

    await listCards(orgSlug)

    const [after] = await panelRows(eo.id)
    expect(after).toMatchObject({
      title: buildCard.title,
      ctaLabel: buildCard.ctaLabel,
      completedAt: null,
    })
    expect(after?.summary).toMatch(/^A civic panel is a group of residents/)
  })

  it('renames the build card as the text that finishes it is read', async () => {
    const orgSlug = 'eo-civic-build-sent-renamed'
    const eo = await seedElectedOffice(orgSlug)
    await listCards(orgSlug)
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { title: "Build your citizens' panel" },
    })
    await seedText(orgSlug, OutreachStatus.completed)

    await listCards(orgSlug)

    const [after] = await panelRows(eo.id)
    expect(after?.title).toBe(buildCard.title)
    expect(after?.completedAt).not.toBeNull()
  })

  it('keeps an open build card from lapsing into missed', async () => {
    const eo = await seedElectedOffice('eo-civic-build-lapsed')
    await listCards('eo-civic-build-lapsed')
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { dueDate: subDays(new Date(), 1) },
    })

    const cards = await listCards('eo-civic-build-lapsed')

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject(buildCard)
  })
})

const seedPlan = (
  electedOfficeId: string,
  organizationSlug: string,
  status: CivicPanelBuildPlanStatus = CivicPanelBuildPlanStatus.active,
) =>
  service.prisma.civicPanelBuildPlan.create({
    data: {
      electedOfficeId,
      organizationSlug,
      goalMembers: 100,
      hoursPerWeek: 1,
      status,
      steps: {
        create: [
          {
            wave: 1,
            channel: CivicPanelBuildChannel.text,
            targetSize: 3000,
          },
          {
            wave: 1,
            channel: CivicPanelBuildChannel.phone_banking,
            targetSize: 30,
          },
        ],
      },
    },
    include: { steps: true },
  })

describe('GET /v1/dashboard/cards: the build card once there is a plan', () => {
  it("reads as the plan's next step and opens it", async () => {
    const orgSlug = 'eo-civic-build-plan-next'
    const eo = await seedElectedOffice(orgSlug)
    const plan = await seedPlan(eo.id, orgSlug)
    const text = plan.steps.find((step) => step.channel === 'text')

    const cards = await listCards(orgSlug)

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      type: 'civic_panel',
      sourceExternalId: `build:${eo.id}`,
      title: 'Invite residents to your civic panel by text',
      summary: 'Your panel can give about 0 of the 96 answers you need.',
      ctaLabel: 'Start the text',
      ctaHref: `/dashboard/contacts/citizens-panel?step=${text?.id}`,
      completedAt: null,
    })
  })

  it('follows the plan to the next step once one is skipped', async () => {
    const orgSlug = 'eo-civic-build-plan-skip'
    const eo = await seedElectedOffice(orgSlug)
    const plan = await seedPlan(eo.id, orgSlug)
    await listCards(orgSlug)
    const text = plan.steps.find((step) => step.channel === 'text')
    const calls = plan.steps.find((step) => step.channel === 'phone_banking')
    await service.prisma.civicPanelBuildStep.update({
      where: { id: text?.id },
      data: { skippedAt: new Date() },
    })

    const [card] = await listCards(orgSlug)

    expect(card).toMatchObject({
      title: 'Call residents to invite them to your civic panel',
      ctaLabel: 'Start the calls',
      ctaHref: `/dashboard/contacts/citizens-panel?step=${calls?.id}`,
    })
  })

  // A text being worked is past checkout, which finishes the card, so the
  // step a card can show in progress is a call list or a walk.
  it('keeps the official going on a call list already started', async () => {
    const orgSlug = 'eo-civic-build-plan-calling'
    const eo = await seedElectedOffice(orgSlug)
    const plan = await seedPlan(eo.id, orgSlug)
    const text = plan.steps.find((step) => step.channel === 'text')
    const calls = plan.steps.find((step) => step.channel === 'phone_banking')
    await service.prisma.civicPanelBuildStep.update({
      where: { id: text?.id },
      data: { skippedAt: new Date() },
    })
    await service.prisma.civicPanelBuildStep.update({
      where: { id: calls?.id },
      data: { startedAt: new Date() },
    })

    const [card] = await listCards(orgSlug)

    expect(card).toMatchObject({
      title: 'Finish your civic panel calls',
      ctaLabel: 'Keep calling',
      ctaHref: `/dashboard/contacts/citizens-panel?step=${calls?.id}`,
    })
  })

  it('goes back to the start words when the plan ran out of people', async () => {
    const orgSlug = 'eo-civic-build-plan-exhausted'
    const eo = await seedElectedOffice(orgSlug)
    await seedPlan(eo.id, orgSlug, CivicPanelBuildPlanStatus.exhausted)

    const cards = await listCards(orgSlug)

    expect(cards[0]).toMatchObject({ ...buildCard, completedAt: null })
  })

  it('is done once the plan reaches its goal', async () => {
    const orgSlug = 'eo-civic-build-plan-goal'
    const eo = await seedElectedOffice(orgSlug)
    await seedPlan(eo.id, orgSlug, CivicPanelBuildPlanStatus.completed)

    const active = await listCards(orgSlug)
    const done = await listCards(orgSlug, 'done')

    expect(active).toHaveLength(0)
    expect(done[0]).toMatchObject(buildCard)
  })

  it('keeps a skipped card skipped while its words follow the plan', async () => {
    const orgSlug = 'eo-civic-build-plan-dismissed'
    const eo = await seedElectedOffice(orgSlug)
    await listCards(orgSlug)
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    const dismissedAt = subDays(new Date(), 1)
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { dismissedAt },
    })
    await seedPlan(eo.id, orgSlug)

    expect(await listCards(orgSlug)).toHaveLength(0)
    const [after] = await panelRows(eo.id)
    expect(after).toMatchObject({
      title: 'Invite residents to your civic panel by text',
      dismissedAt,
      completedAt: null,
    })
  })

  it('stays done once the text went out, whatever the plan says next', async () => {
    const orgSlug = 'eo-civic-build-plan-sent'
    const eo = await seedElectedOffice(orgSlug)
    await seedPlan(eo.id, orgSlug)
    await seedText(orgSlug, OutreachStatus.pending)

    await listCards(orgSlug)
    const done = await listCards(orgSlug, 'done')

    expect(done[0]).toMatchObject(buildCard)
    expect(done[0]?.completedAt).not.toBeNull()
  })
})

describe("GET /v1/dashboard/cards: the plan's next step once the build card is done", () => {
  // The text is paid for, which finishes the build card; the plan's calls
  // and doors are what is left.
  const builtAndPaid = async (orgSlug: string) => {
    const eo = await seedElectedOffice(orgSlug)
    const plan = await seedPlan(eo.id, orgSlug)
    const doors = await service.prisma.civicPanelBuildStep.create({
      data: {
        planId: plan.id,
        wave: 1,
        channel: CivicPanelBuildChannel.door_knocking,
        targetSize: 100,
      },
    })
    const text = plan.steps.find((step) => step.channel === 'text')
    const calls = plan.steps.find((step) => step.channel === 'phone_banking')
    if (!text || !calls) throw new Error('no steps')
    await service.prisma.civicPanelBuildStep.update({
      where: { id: text.id },
      data: { skippedAt: new Date() },
    })
    await seedText(orgSlug, OutreachStatus.pending)
    return { eo, plan, calls, doors }
  }

  const stepRows = (electedOfficeId: string) =>
    service.prisma.dashboardCard.findMany({
      where: {
        electedOfficeId,
        type: DashboardCardType.civic_panel,
        sourceExternalId: { startsWith: 'panel-step:' },
      },
    })

  it("gives the plan's ready step its own card, in the panel page's words", async () => {
    const orgSlug = 'eo-civic-step-card'
    const { calls } = await builtAndPaid(orgSlug)

    const cards = await listCards(orgSlug)

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      type: 'civic_panel',
      sourceExternalId: `panel-step:${calls.id}`,
      title: 'Call residents to invite them to your civic panel',
      summary: 'Your panel can give about 0 of the 96 answers you need.',
      ctaLabel: 'Start the calls',
      ctaHref: `/dashboard/contacts/citizens-panel?step=${calls.id}`,
      completedAt: null,
    })
    expect(await listCards(orgSlug, 'done')).toEqual([
      expect.objectContaining(buildCard),
    ])
  })

  it('makes no second card on a repeat read, and follows its step as it is worked', async () => {
    const orgSlug = 'eo-civic-step-card-repeat'
    const { eo, calls, doors } = await builtAndPaid(orgSlug)
    await listCards(orgSlug)
    await service.prisma.civicPanelBuildStep.update({
      where: { id: doors.id },
      data: { skippedAt: new Date() },
    })
    await service.prisma.civicPanelBuildStep.update({
      where: { id: calls.id },
      data: { startedAt: new Date() },
    })

    const cards = await listCards(orgSlug)

    expect(await stepRows(eo.id)).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      sourceExternalId: `panel-step:${calls.id}`,
      title: 'Finish your civic panel calls',
      ctaLabel: 'Keep calling',
    })
  })

  it('keeps a skipped card skipped, and gives the next step a card of its own', async () => {
    const orgSlug = 'eo-civic-step-card-skipped'
    const { eo, calls, doors } = await builtAndPaid(orgSlug)
    const [card] = await listCards(orgSlug)
    if (!card) throw new Error('no card')
    await act(orgSlug, card.id, 'dismiss')

    expect(await listCards(orgSlug)).toHaveLength(0)

    await service.prisma.civicPanelBuildStep.update({
      where: { id: calls.id },
      data: { skippedAt: new Date() },
    })
    const cards = await listCards(orgSlug)

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      sourceExternalId: `panel-step:${doors.id}`,
      title: 'Knock on doors to invite residents to your civic panel',
      ctaLabel: 'Start door knocking',
      ctaHref: `/dashboard/contacts/citizens-panel?step=${doors.id}`,
    })
    expect(await stepRows(eo.id)).toHaveLength(1)
  })

  it('cannot be marked done by hand', async () => {
    const orgSlug = 'eo-civic-step-card-complete'
    await builtAndPaid(orgSlug)
    const [card] = await listCards(orgSlug)
    if (!card) throw new Error('no card')
    await act(orgSlug, card.id, 'complete')

    expect(await listCards(orgSlug)).toEqual([
      expect.objectContaining({ id: card.id, completedAt: null }),
    ])
  })

  it('goes once the plan reaches its goal', async () => {
    const orgSlug = 'eo-civic-step-card-goal'
    const { eo, plan } = await builtAndPaid(orgSlug)
    await listCards(orgSlug)
    await service.prisma.civicPanelBuildPlan.update({
      where: { id: plan.id },
      data: { status: CivicPanelBuildPlanStatus.completed },
    })

    expect(await listCards(orgSlug)).toHaveLength(0)
    expect(await stepRows(eo.id)).toHaveLength(0)
  })

  it('gives no step card while the build card is open, or set aside', async () => {
    const orgSlug = 'eo-civic-step-card-build-open'
    const eo = await seedElectedOffice(orgSlug)
    await listCards(orgSlug)
    const [build] = await panelRows(eo.id)
    if (!build) throw new Error('no card')
    await act(orgSlug, build.id, 'dismiss')
    await seedPlan(eo.id, orgSlug)

    expect(await listCards(orgSlug)).toHaveLength(0)
    expect(await stepRows(eo.id)).toHaveLength(0)
  })
})

describe('GET /v1/dashboard/cards: a card per priority', () => {
  const builtOffice = async (orgSlug: string) => {
    const eo = await seedElectedOffice(orgSlug)
    await seedText(orgSlug, OutreachStatus.pending)
    return eo
  }

  const priorityRows = async (electedOfficeId: string) =>
    (await panelRows(electedOfficeId)).filter(
      (card) => !card.sourceExternalId.startsWith('build:'),
    )

  it('makes one card per open priority, and no duplicate on a repeat read', async () => {
    const eo = await builtOffice('eo-civic-card-create')
    await seedPriority(eo.id, 'Affordable housing')
    await seedPriority(eo.id, 'Road safety')

    await listCards('eo-civic-card-create')
    await listCards('eo-civic-card-create')

    expect((await priorityRows(eo.id)).map((card) => card.title)).toEqual([
      'Affordable housing',
      'Road safety',
    ])
  })

  it('keeps a skipped card skipped', async () => {
    const eo = await builtOffice('eo-civic-card-skipped')
    await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-card-skipped')
    const [card] = await priorityRows(eo.id)
    if (!card) throw new Error('no card')
    await service.client.put(`/v1/dashboard/cards/${card.id}/dismiss`, null, {
      headers: { 'x-organization-slug': 'eo-civic-card-skipped' },
    })

    expect(await listCards('eo-civic-card-skipped')).toHaveLength(0)
    const cards = await priorityRows(eo.id)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.dismissedAt).not.toBeNull()
  })

  it('follows a renamed priority', async () => {
    const eo = await builtOffice('eo-civic-card-renamed')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-card-renamed')

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { title: 'Housing costs' },
    })
    await listCards('eo-civic-card-renamed')

    const [card] = await priorityRows(eo.id)
    expect(card?.title).toBe('Housing costs')
  })

  it("reads the priority's next step, and follows it as it moves", async () => {
    const eo = await builtOffice('eo-civic-card-next-step')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await service.prisma.priority.update({
      where: { id: housing.id },
      data: {
        status: { version: 1, steps: [] },
        currentStep: 'evidence',
        nextAction: 'Ask the planning director for the permit data.',
      },
    })

    const [first] = await listCards('eo-civic-card-next-step')
    expect(first).toMatchObject({
      title: 'Affordable housing',
      summary: 'Ask the planning director for the permit data.',
      ctaLabel: 'Open priority',
      ctaHref: `/dashboard/priorities/${housing.id}`,
    })

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { nextAction: 'Draft two options for the council.' },
    })
    const [moved] = await listCards('eo-civic-card-next-step')
    expect(moved?.summary).toBe('Draft two options for the council.')

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { nextAction: null },
    })
    const [worked] = await listCards('eo-civic-card-next-step')
    expect(worked?.summary).toBe('What we know')
  })

  it('retires the card once the plan is ready, and brings it back when a step comes open again', async () => {
    const orgSlug = 'eo-civic-card-plan-ready'
    const eo = await builtOffice(orgSlug)
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { status: { version: 1, steps: [] }, currentStep: 'plan' },
    })
    expect(titles(await listCards(orgSlug))).toEqual(['Affordable housing'])

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { currentStep: null, nextAction: null },
    })
    expect(await listCards(orgSlug)).toHaveLength(0)
    expect(await listCards(orgSlug, 'this_week')).toHaveLength(0)
    expect(await priorityRows(eo.id)).toHaveLength(0)

    await listCards(orgSlug)
    expect(await priorityRows(eo.id)).toHaveLength(0)

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: {
        currentStep: 'evidence',
        nextAction: 'Check the new permit numbers.',
      },
    })
    const [back] = await listCards(orgSlug)
    expect(back).toMatchObject({
      title: 'Affordable housing',
      summary: 'Check the new permit numbers.',
    })
  })

  it('reads an unknown step as the first step', async () => {
    const eo = await builtOffice('eo-civic-card-unknown-step')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await service.prisma.priority.update({
      where: { id: housing.id },
      data: {
        status: { version: 1, steps: [] },
        currentStep: 'a_step_from_a_newer_build',
        nextAction: null,
      },
    })

    const [card] = await listCards('eo-civic-card-unknown-step')
    expect(card?.summary).toBe('The problem')
  })

  it('keeps an open card from lapsing into missed while its priority is open', async () => {
    const eo = await builtOffice('eo-civic-card-lapsed')
    await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-card-lapsed')
    const [card] = await priorityRows(eo.id)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { dueDate: subDays(new Date(), 1) },
    })

    expect(titles(await listCards('eo-civic-card-lapsed'))).toEqual([
      'Affordable housing',
    ])
    expect(await listCards('eo-civic-card-lapsed', 'missed')).toHaveLength(0)
  })

  it('drops the card once its priority is archived, skipped or not, and brings it back when unarchived', async () => {
    const orgSlug = 'eo-civic-card-archived'
    const eo = await builtOffice(orgSlug)
    const housing = await seedPriority(eo.id, 'Affordable housing')
    const roads = await seedPriority(eo.id, 'Road safety')
    await listCards(orgSlug)
    const roadsCard = (await priorityRows(eo.id)).find(
      (card) => card.title === 'Road safety',
    )
    if (!roadsCard) throw new Error('no card')
    await act(orgSlug, roadsCard.id, 'dismiss')

    await service.prisma.priority.updateMany({
      where: { id: { in: [housing.id, roads.id] } },
      data: { archivedAt: new Date() },
    })
    expect(await listCards(orgSlug)).toHaveLength(0)
    expect(await priorityRows(eo.id)).toHaveLength(0)
    expect(await panelRows(eo.id)).toHaveLength(1)

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { archivedAt: null },
    })
    expect(titles(await listCards(orgSlug))).toEqual(['Affordable housing'])
  })

  it('cannot be marked done by hand', async () => {
    const orgSlug = 'eo-civic-card-no-complete'
    const eo = await builtOffice(orgSlug)
    await seedPriority(eo.id, 'Affordable housing')
    const [card] = await listCards(orgSlug)
    if (!card) throw new Error('no card')

    await act(orgSlug, card.id, 'complete')
    expect(titles(await listCards(orgSlug))).toEqual(['Affordable housing'])
    expect(titles(await listCards(orgSlug, 'done'))).toEqual([buildCard.title])
  })

  it('keeps a card marked done earlier done', async () => {
    const orgSlug = 'eo-civic-card-done-earlier'
    const eo = await builtOffice(orgSlug)
    await seedPriority(eo.id, 'Affordable housing')
    const [card] = await listCards(orgSlug)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { completedAt: new Date() },
    })

    expect(await listCards(orgSlug)).toHaveLength(0)
    expect(titles(await listCards(orgSlug, 'done'))).toEqual(
      ['Affordable housing', buildCard.title].sort(),
    )
  })
})

const seedOtherCards = (electedOfficeId: string) =>
  service.prisma.dashboardCard.createMany({
    data: [
      {
        electedOfficeId,
        type: DashboardCardType.briefing,
        sourceExternalId: 'briefing-1',
        title: 'City council meeting',
        summary: 'Three items worth reading first.',
        ctaLabel: 'Prepare for the meeting',
        ctaHref: '/dashboard/briefings/2026-10-20',
        dueDate: addDays(new Date(), 5),
      },
      {
        electedOfficeId,
        type: DashboardCardType.agenda_item,
        sourceExternalId: 'briefing-1',
        sourceItemId: 'item-1',
        title: 'Rezoning on Main Street',
        summary: 'A vote on the corner lot.',
        ctaLabel: 'Learn more',
        ctaHref: '/dashboard/briefings/2026-10-20/items/item-1',
        dueDate: addDays(new Date(), 5),
      },
      {
        electedOfficeId,
        type: DashboardCardType.community_issue,
        sourceExternalId: 'issue-1',
        title: 'Potholes on Elm',
        summary: 'Residents keep raising it.',
        ctaLabel: 'View issue',
        ctaHref: '/dashboard/community-issues/issue-1',
        dueDate: addDays(new Date(), 7),
      },
    ],
  })

const OTHER_TITLES = [
  'City council meeting',
  'Potholes on Elm',
  'Rezoning on Main Street',
]

describe('The civic panel build card, with the priorities and the usual cards under it', () => {
  const ALL = [buildCard.title, 'Affordable housing', ...OTHER_TITLES].sort()
  const WITHOUT_BUILD = ['Affordable housing', ...OTHER_TITLES].sort()

  const officeWithBuildCard = async (orgSlug: string) => {
    const eo = await seedElectedOffice(orgSlug)
    await seedPriority(eo.id, 'Affordable housing')
    await seedOtherCards(eo.id)
    const cards = await listCards(orgSlug)
    const build = cards.find((card) => card.title === buildCard.title)
    if (!build) throw new Error('no build card')
    return { eo, cards, build }
  }

  it('gives an office that onboarded long ago the build card on its next visit, beside its other cards', async () => {
    const orgSlug = 'eo-civic-seq-existing'
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        createdAt: subDays(new Date(), 400),
      },
    })
    await seedPriority(eo.id, 'Affordable housing')
    await seedOtherCards(eo.id)
    expect(await panelRows(eo.id)).toHaveLength(0)

    expect(titles(await listCards(orgSlug))).toEqual(ALL)

    await seedText(orgSlug, OutreachStatus.pending)
    expect(titles(await listCards(orgSlug))).toEqual(WITHOUT_BUILD)
    expect(titles(await listCards(orgSlug, 'done'))).toEqual([buildCard.title])
  })

  it('keeps every other card, priorities included, on the home page while the build card is open', async () => {
    const { cards } = await officeWithBuildCard('eo-civic-seq-others')
    expect(titles(cards)).toEqual(ALL)
  })

  it('keeps the priority cards while the build card is set aside and once it is brought back', async () => {
    const orgSlug = 'eo-civic-seq-not-for-me'
    const { build } = await officeWithBuildCard(orgSlug)

    await act(orgSlug, build.id, 'dismiss')
    expect(titles(await listCards(orgSlug))).toEqual(WITHOUT_BUILD)
    expect(titles(await listCards(orgSlug, 'skipped'))).toEqual([
      buildCard.title,
    ])

    await act(orgSlug, build.id, 'restore')
    expect(titles(await listCards(orgSlug))).toEqual(ALL)
    expect(await listCards(orgSlug, 'skipped')).toHaveLength(0)
  })

  it('puts the build card off for 3 days, then brings it back above the priorities', async () => {
    const orgSlug = 'eo-civic-seq-snooze'
    const { eo, build } = await officeWithBuildCard(orgSlug)

    await act(orgSlug, build.id, 'snooze')
    expect(titles(await listCards(orgSlug))).toEqual(WITHOUT_BUILD)
    const [snoozed] = (await panelRows(eo.id)).filter(
      (card) => card.id === build.id,
    )
    expect(snoozed?.snoozedUntil?.getTime()).toBeGreaterThan(
      addDays(new Date(), 2).getTime(),
    )
    expect(snoozed?.dismissedAt).toBeNull()

    await service.prisma.dashboardCard.update({
      where: { id: build.id },
      data: { snoozedUntil: subDays(new Date(), 1) },
    })
    expect(titles(await listCards(orgSlug))).toEqual(ALL)
  })

  it('keeps a priority card waiting behind the open build card from lapsing into missed', async () => {
    const orgSlug = 'eo-civic-seq-waiting-lapse'
    const { eo } = await officeWithBuildCard(orgSlug)
    const housing = (await panelRows(eo.id)).find(
      (card) => card.title === 'Affordable housing',
    )
    if (!housing) throw new Error('no priority card')
    await service.prisma.dashboardCard.update({
      where: { id: housing.id },
      data: { dueDate: subDays(new Date(), 1) },
    })

    expect(titles(await listCards(orgSlug))).toEqual(ALL)
    expect(await listCards(orgSlug, 'missed')).toHaveLength(0)
    const [row] = (await panelRows(eo.id)).filter(
      (card) => card.id === housing.id,
    )
    expect(row?.dueDate.getTime()).toBeGreaterThan(Date.now())
  })

  it('is still done by the panel text after it was put off', async () => {
    const orgSlug = 'eo-civic-seq-snooze-sent'
    const { eo, build } = await officeWithBuildCard(orgSlug)
    await act(orgSlug, build.id, 'snooze')
    await seedText(orgSlug, OutreachStatus.pending)

    expect(titles(await listCards(orgSlug))).toEqual(WITHOUT_BUILD)

    const row = (await panelRows(eo.id)).find((card) => card.id === build.id)
    expect(row?.completedAt).not.toBeNull()
    expect(row?.snoozedUntil).toBeNull()
  })

  it('keeps the priority card under the build card when Mark done is called on it', async () => {
    const orgSlug = 'eo-civic-seq-priority-done'
    const { cards } = await officeWithBuildCard(orgSlug)
    const housing = cards.find((card) => card.title === 'Affordable housing')
    if (!housing) throw new Error('no priority card')

    await act(orgSlug, housing.id, 'complete')

    expect(titles(await listCards(orgSlug))).toEqual(ALL)
    expect(await listCards(orgSlug, 'done')).toHaveLength(0)
  })

  it('still lets the usual cards be marked done', async () => {
    const orgSlug = 'eo-civic-seq-other-done'
    const { cards } = await officeWithBuildCard(orgSlug)
    const meeting = cards.find((card) => card.title === 'City council meeting')
    if (!meeting) throw new Error('no briefing card')

    await act(orgSlug, meeting.id, 'complete')

    expect(titles(await listCards(orgSlug, 'done'))).toEqual([
      'City council meeting',
    ])
  })
})

describe('GET /v1/dashboard/cards with serve-citizen-panels off', () => {
  it('lists the usual cards exactly as before', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const eo = await seedElectedOffice('eo-civic-flag-off-usual')
    await seedPriority(eo.id, 'Affordable housing')
    await seedOtherCards(eo.id)

    expect(titles(await listCards('eo-civic-flag-off-usual'))).toEqual(
      OTHER_TITLES,
    )
    expect(await panelRows(eo.id)).toHaveLength(0)
  })

  it('makes no panel card and lists none it already has', async () => {
    const eo = await seedElectedOffice('eo-civic-flag-off')
    await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-flag-off')
    expect(await panelRows(eo.id)).toHaveLength(2)

    isFeatureEnabled.mockResolvedValue(false)
    const other = await seedElectedOffice('eo-civic-flag-off-fresh')
    await seedText('eo-civic-flag-off-fresh', OutreachStatus.pending)
    await seedPriority(other.id, 'Road safety')

    expect(await listCards('eo-civic-flag-off')).toHaveLength(0)
    expect(await listCards('eo-civic-flag-off', 'this_week')).toHaveLength(0)
    expect(await listCards('eo-civic-flag-off-fresh')).toHaveLength(0)
    expect(await panelRows(other.id)).toHaveLength(0)
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: service.user.id }),
      feature: 'serve-citizen-panels',
    })
  })
})
