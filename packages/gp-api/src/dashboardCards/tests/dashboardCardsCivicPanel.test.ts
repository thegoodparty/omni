import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, subDays } from 'date-fns'
import {
  CivicPanelBuildChannel,
  CivicPanelBuildPlanStatus,
  DashboardCardType,
  ManagedCivicPanelStatus,
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

const MANAGED_PREFIX = 'managed-panel:'
const PROGRESS_PREFIX = 'managed-panel-progress:'

const listAll = async (orgSlug: string, bucket = 'active') => {
  const res = await service.client.get<DashboardCardsResponse>(
    `/v1/dashboard/cards?bucket=${bucket}`,
    { headers: { 'x-organization-slug': orgSlug } },
  )
  expect(res.status).toBe(200)
  return res.data.cards
}

// Every card but the managed panel's, which leads every office without an
// enrollment, and its progress card once it has one. Both have their own
// tests below.
const listCards = async (orgSlug: string, bucket = 'active') =>
  (await listAll(orgSlug, bucket)).filter(
    (card) =>
      !card.sourceExternalId.startsWith(MANAGED_PREFIX) &&
      !card.sourceExternalId.startsWith(PROGRESS_PREFIX),
  )

const panelRows = (electedOfficeId: string) =>
  service.prisma.dashboardCard.findMany({
    where: {
      electedOfficeId,
      type: DashboardCardType.civic_panel,
      NOT: [
        { sourceExternalId: { startsWith: MANAGED_PREFIX } },
        { sourceExternalId: { startsWith: PROGRESS_PREFIX } },
      ],
    },
    orderBy: { title: 'asc' },
  })

const managedRows = (electedOfficeId: string) =>
  service.prisma.dashboardCard.findMany({
    where: {
      electedOfficeId,
      type: DashboardCardType.civic_panel,
      sourceExternalId: { startsWith: MANAGED_PREFIX },
    },
  })

const seedEnrollment = (organizationSlug: string) =>
  service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug,
      inviteMessage: 'Hi, this is Alex.',
      consentVersion: 'test',
      approvedAt: new Date(),
      goalMembers: 100,
    },
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
  title: 'Know what residents think before you decide',
  ctaLabel: 'Build your panel',
  ctaHref: '/dashboard/contacts/citizens-panel',
}

// With an active plan the same card opens that plan, never a second build.
const planCard = { ...buildCard, ctaLabel: 'See your plan' }

// GoodParty builds the panel for the office, so the card that offers it
// leads the panel cards until the official approves the invite.
const managedCard = {
  type: 'civic_panel',
  title: 'Know what your district thinks before you vote',
  summary:
    'Residents from every part of your district, matched by age, gender ' +
    'and race. Free in early access.',
  ctaLabel: 'Build my civic panel',
  ctaHref: '/dashboard/contacts/citizens-panel',
}

const seedBuildCard = (electedOfficeId: string, completedAt: Date | null) =>
  service.prisma.dashboardCard.create({
    data: {
      electedOfficeId,
      type: DashboardCardType.civic_panel,
      sourceExternalId: `build:${electedOfficeId}`,
      title: buildCard.title,
      summary: 'A civic panel gives you residents from across your district.',
      ctaLabel: buildCard.ctaLabel,
      ctaHref: buildCard.ctaHref,
      dueDate: addDays(new Date(), 30),
      completedAt,
    },
  })

describe('GET /v1/dashboard/cards: the managed civic panel card', () => {
  it('starts an office on the managed card, with a card per priority beside it', async () => {
    const orgSlug = 'eo-civic-managed-first'
    const eo = await seedElectedOffice(orgSlug)
    await seedPriority(eo.id, 'Affordable housing')

    const cards = await listAll(orgSlug)

    expect(titles(cards)).toEqual(
      [managedCard.title, 'Affordable housing'].sort(),
    )
    expect(
      cards.find((card) => card.title === managedCard.title),
    ).toMatchObject({
      ...managedCard,
      sourceExternalId: `managed-panel:${eo.id}`,
      completedAt: null,
    })
    expect(managedCard.summary.split(' ').length).toBeLessThanOrEqual(20)
    // The do-it-yourself build card is not offered any more.
    expect(
      (await panelRows(eo.id)).filter((card) =>
        card.sourceExternalId.startsWith('build:'),
      ),
    ).toHaveLength(0)
  })

  it('makes no second card on a repeat read', async () => {
    const orgSlug = 'eo-civic-managed-idempotent'
    const eo = await seedElectedOffice(orgSlug)

    await Promise.all([listAll(orgSlug), listAll(orgSlug, 'this_week')])
    await listAll(orgSlug)

    expect(await managedRows(eo.id)).toHaveLength(1)
  })

  it('is done once the office approves its invite', async () => {
    const orgSlug = 'eo-civic-managed-approved'
    await seedElectedOffice(orgSlug)
    await listAll(orgSlug)
    await seedEnrollment(orgSlug)

    expect(await listCards(orgSlug)).toHaveLength(0)
    const [done] = await listAll(orgSlug, 'done')
    expect(done).toMatchObject(managedCard)
    expect(done?.completedAt).not.toBeNull()
  })

  it('opens again once the office stops its panel', async () => {
    const orgSlug = 'eo-civic-managed-stopped'
    await seedElectedOffice(orgSlug)
    await listAll(orgSlug)
    await seedEnrollment(orgSlug)
    expect(await listCards(orgSlug)).toHaveLength(0)

    await service.prisma.managedCivicPanel.update({
      where: { organizationSlug: orgSlug },
      data: { status: ManagedCivicPanelStatus.stopped, stoppedAt: new Date() },
    })

    const [card] = await listAll(orgSlug)
    expect(card).toMatchObject({ ...managedCard, completedAt: null })
  })

  it('makes no card for an office that approved before its first read', async () => {
    const orgSlug = 'eo-civic-managed-approved-first'
    const eo = await seedElectedOffice(orgSlug)
    await seedEnrollment(orgSlug)

    expect(await listCards(orgSlug)).toHaveLength(0)
    expect(await managedRows(eo.id)).toHaveLength(0)
  })

  it('cannot be marked done by hand', async () => {
    const orgSlug = 'eo-civic-managed-no-complete'
    const eo = await seedElectedOffice(orgSlug)
    const [card] = await listAll(orgSlug)
    if (!card) throw new Error('no card')

    await act(orgSlug, card.id, 'complete')

    const [row] = await managedRows(eo.id)
    expect(row?.completedAt).toBeNull()
    expect(await listAll(orgSlug)).toHaveLength(1)
  })

  it('counts a skipped card as done once the office approves', async () => {
    const orgSlug = 'eo-civic-managed-skipped'
    const eo = await seedElectedOffice(orgSlug)
    const [card] = await listAll(orgSlug)
    if (!card) throw new Error('no card')
    await act(orgSlug, card.id, 'dismiss')
    await seedEnrollment(orgSlug)

    await listAll(orgSlug)

    const [after] = await managedRows(eo.id)
    expect(after?.completedAt).not.toBeNull()
    expect(after?.dismissedAt).toBeNull()
  })

  it('rewrites an open card still holding old words', async () => {
    const orgSlug = 'eo-civic-managed-old-words'
    const eo = await seedElectedOffice(orgSlug)
    await listAll(orgSlug)
    await service.prisma.dashboardCard.updateMany({
      where: { electedOfficeId: eo.id },
      data: { title: 'Build your panel', ctaLabel: 'Get started' },
    })

    const [card] = await listAll(orgSlug)

    expect(card).toMatchObject(managedCard)
  })

  it('keeps an open card from lapsing into missed', async () => {
    const orgSlug = 'eo-civic-managed-lapsed'
    const eo = await seedElectedOffice(orgSlug)
    await listAll(orgSlug)
    await service.prisma.dashboardCard.updateMany({
      where: { electedOfficeId: eo.id },
      data: { dueDate: subDays(new Date(), 1) },
    })

    const cards = await listAll(orgSlug)

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject(managedCard)
    expect(await listAll(orgSlug, 'missed')).toHaveLength(0)
  })

  it('takes away an open build card left from before, and keeps a done one done', async () => {
    const open = await seedElectedOffice('eo-civic-managed-old-build')
    await seedBuildCard(open.id, null)
    const done = await seedElectedOffice('eo-civic-managed-done-build')
    const completedAt = subDays(new Date(), 3)
    await seedBuildCard(done.id, completedAt)

    expect(titles(await listAll('eo-civic-managed-old-build'))).toEqual([
      managedCard.title,
    ])
    expect(await panelRows(open.id)).toHaveLength(0)
    await listAll('eo-civic-managed-done-build')
    const [kept] = await panelRows(done.id)
    expect(kept?.completedAt).toEqual(completedAt)
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
  // The card opens the plan on the panel page, which shows its next step, so
  // the card itself never names a step or counts members.
  it('keeps its words and opens the plan with See your plan', async () => {
    const orgSlug = 'eo-civic-build-plan-next'
    const eo = await seedElectedOffice(orgSlug)
    await seedPlan(eo.id, orgSlug)

    const cards = await listCards(orgSlug)

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      ...planCard,
      sourceExternalId: `build:${eo.id}`,
      completedAt: null,
    })
    expect(cards[0]?.summary).not.toMatch(/members/)
  })

  // A text being worked is past checkout, which finishes the card, so the
  // steps a card can see worked first are a call list or a walk.
  it('keeps opening the plan while the official calls before texting', async () => {
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

    expect(card).toMatchObject({ ...planCard, completedAt: null })
  })

  it("rewrites a card still showing the plan's step and member count", async () => {
    const orgSlug = 'eo-civic-build-plan-old-words'
    const eo = await seedElectedOffice(orgSlug)
    const plan = await seedPlan(eo.id, orgSlug)
    await listCards(orgSlug)
    const text = plan.steps.find((step) => step.channel === 'text')
    await service.prisma.dashboardCard.updateMany({
      where: { electedOfficeId: eo.id, type: DashboardCardType.civic_panel },
      data: {
        title: 'Hear from more than the loudest voices',
        summary: '0 members so far.',
        ctaLabel: 'Start the text',
        ctaHref: `/dashboard/contacts/citizens-panel?step=${text?.id}`,
      },
    })

    const [card] = await listCards(orgSlug)

    expect(card).toMatchObject(planCard)
  })

  it('makes the card only for an office with a plan', async () => {
    const orgSlug = 'eo-civic-build-plan-later'
    const eo = await seedElectedOffice(orgSlug)

    expect(await listCards(orgSlug)).toHaveLength(0)

    await seedPlan(eo.id, orgSlug)
    const [after] = await listCards(orgSlug)

    expect(after).toMatchObject(planCard)
  })

  // Its open words would start a second plan, which GoodParty now builds.
  it('takes the card away once the plan ran out of people', async () => {
    const orgSlug = 'eo-civic-build-plan-exhausted'
    const eo = await seedElectedOffice(orgSlug)
    const plan = await seedPlan(eo.id, orgSlug)
    await listCards(orgSlug)
    await service.prisma.civicPanelBuildPlan.update({
      where: { id: plan.id },
      data: { status: CivicPanelBuildPlanStatus.exhausted },
    })

    expect(await listCards(orgSlug)).toHaveLength(0)
    expect(await panelRows(eo.id)).toHaveLength(0)
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

  it('keeps a skipped card skipped', async () => {
    const orgSlug = 'eo-civic-build-plan-dismissed'
    const eo = await seedElectedOffice(orgSlug)
    await seedPlan(eo.id, orgSlug)
    await listCards(orgSlug)
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    const dismissedAt = subDays(new Date(), 1)
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { dismissedAt },
    })

    expect(await listCards(orgSlug)).toHaveLength(0)
    const [after] = await panelRows(eo.id)
    expect(after).toMatchObject({
      title: buildCard.title,
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
      title: 'Call 30 residents',
      ctaLabel: 'Start the calls',
      ctaHref: `/dashboard/contacts/citizens-panel?step=${calls.id}`,
      completedAt: null,
    })
    // Who and how long, never where the panel stands.
    expect(cards[0]?.summary).toMatch(
      /^People a text can't reach.* About 2 hours of your time\.$/,
    )
    expect(cards[0]?.summary).not.toMatch(/members/)
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
      title: 'Call 30 residents',
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
      title: 'Knock on 100 doors in a walkable area',
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
    await seedPlan(eo.id, orgSlug)
    await listCards(orgSlug)
    const [build] = await panelRows(eo.id)
    if (!build) throw new Error('no card')
    await act(orgSlug, build.id, 'dismiss')

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
    expect(await panelRows(eo.id)).toHaveLength(0)

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
    expect(await listCards(orgSlug, 'done')).toHaveLength(0)
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
    expect(titles(await listCards(orgSlug, 'done'))).toEqual([
      'Affordable housing',
    ])
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

describe('The managed panel card, with the priorities and the usual cards under it', () => {
  const ALL = [managedCard.title, 'Affordable housing', ...OTHER_TITLES].sort()
  const WITHOUT_MANAGED = ['Affordable housing', ...OTHER_TITLES].sort()

  const officeWithManagedCard = async (orgSlug: string) => {
    const eo = await seedElectedOffice(orgSlug)
    await seedPriority(eo.id, 'Affordable housing')
    await seedOtherCards(eo.id)
    const cards = await listAll(orgSlug)
    const managed = cards.find((card) => card.title === managedCard.title)
    if (!managed) throw new Error('no managed card')
    return { eo, cards, managed }
  }

  it('gives an office that onboarded long ago the card on its next visit, beside its other cards', async () => {
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
    expect(await managedRows(eo.id)).toHaveLength(0)

    expect(titles(await listAll(orgSlug))).toEqual(ALL)

    await seedEnrollment(orgSlug)
    expect(titles(await listCards(orgSlug))).toEqual(WITHOUT_MANAGED)
    expect(titles(await listAll(orgSlug, 'done'))).toEqual([managedCard.title])
  })

  it('keeps the priority cards while the card is set aside and once it is brought back', async () => {
    const orgSlug = 'eo-civic-seq-not-for-me'
    const { managed } = await officeWithManagedCard(orgSlug)

    await act(orgSlug, managed.id, 'dismiss')
    expect(titles(await listAll(orgSlug))).toEqual(WITHOUT_MANAGED)
    expect(titles(await listAll(orgSlug, 'skipped'))).toEqual([
      managedCard.title,
    ])

    await act(orgSlug, managed.id, 'restore')
    expect(titles(await listAll(orgSlug))).toEqual(ALL)
    expect(await listAll(orgSlug, 'skipped')).toHaveLength(0)
  })

  it('puts the card off for 3 days, then brings it back', async () => {
    const orgSlug = 'eo-civic-seq-snooze'
    const { eo, managed } = await officeWithManagedCard(orgSlug)

    await act(orgSlug, managed.id, 'snooze')
    expect(titles(await listAll(orgSlug))).toEqual(WITHOUT_MANAGED)
    const [snoozed] = await managedRows(eo.id)
    expect(snoozed?.snoozedUntil?.getTime()).toBeGreaterThan(
      addDays(new Date(), 2).getTime(),
    )
    expect(snoozed?.dismissedAt).toBeNull()

    await service.prisma.dashboardCard.update({
      where: { id: managed.id },
      data: { snoozedUntil: subDays(new Date(), 1) },
    })
    expect(titles(await listAll(orgSlug))).toEqual(ALL)
  })

  it('is still done by the approval after it was put off', async () => {
    const orgSlug = 'eo-civic-seq-snooze-approved'
    const { eo, managed } = await officeWithManagedCard(orgSlug)
    await act(orgSlug, managed.id, 'snooze')
    await seedEnrollment(orgSlug)

    expect(titles(await listCards(orgSlug))).toEqual(WITHOUT_MANAGED)

    const [row] = await managedRows(eo.id)
    expect(row?.completedAt).not.toBeNull()
    expect(row?.snoozedUntil).toBeNull()
  })

  it('keeps the priority card when Mark done is called on it', async () => {
    const orgSlug = 'eo-civic-seq-priority-done'
    const { cards } = await officeWithManagedCard(orgSlug)
    const housing = cards.find((card) => card.title === 'Affordable housing')
    if (!housing) throw new Error('no priority card')

    await act(orgSlug, housing.id, 'complete')

    expect(titles(await listAll(orgSlug))).toEqual(ALL)
    expect(await listAll(orgSlug, 'done')).toHaveLength(0)
  })

  it('still lets the usual cards be marked done', async () => {
    const orgSlug = 'eo-civic-seq-other-done'
    const { cards } = await officeWithManagedCard(orgSlug)
    const meeting = cards.find((card) => card.title === 'City council meeting')
    if (!meeting) throw new Error('no briefing card')

    await act(orgSlug, meeting.id, 'complete')

    expect(titles(await listAll(orgSlug, 'done'))).toEqual([
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
    await listAll('eo-civic-flag-off')
    expect(await panelRows(eo.id)).toHaveLength(1)
    expect(await managedRows(eo.id)).toHaveLength(1)

    isFeatureEnabled.mockResolvedValue(false)
    const other = await seedElectedOffice('eo-civic-flag-off-fresh')
    await seedText('eo-civic-flag-off-fresh', OutreachStatus.pending)
    await seedPriority(other.id, 'Road safety')

    expect(await listAll('eo-civic-flag-off')).toHaveLength(0)
    expect(await listAll('eo-civic-flag-off', 'this_week')).toHaveLength(0)
    expect(await listAll('eo-civic-flag-off-fresh')).toHaveLength(0)
    expect(await panelRows(other.id)).toHaveLength(0)
    expect(await managedRows(other.id)).toHaveLength(0)
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: service.user.id }),
      feature: 'serve-citizen-panels',
    })
  })
})

describe('GET /v1/dashboard/cards: the managed panel progress card', () => {
  const progressCards = async (orgSlug: string, bucket = 'active') =>
    (await listAll(orgSlug, bucket)).filter((card) =>
      card.sourceExternalId.startsWith(PROGRESS_PREFIX),
    )

  const setPanel = (
    organizationSlug: string,
    data: { status: ManagedCivicPanelStatus; readyAt?: Date | null },
  ) =>
    service.prisma.managedCivicPanel.update({
      where: { organizationSlug },
      data,
    })

  const joinMembers = (organizationSlug: string, count: number) =>
    service.prisma.contactCurrentStatus.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        organizationSlug,
        personId: `member-${i}`,
        field: 'civic_panel' as const,
        value: 'member',
      })),
    })

  it('shows members of the goal and the next invites while it builds', async () => {
    const orgSlug = 'eo-progress-building'
    await seedElectedOffice(orgSlug)
    const enrollment = await seedEnrollment(orgSlug)
    await joinMembers(orgSlug, 12)
    await service.prisma.managedPanelWave.create({
      data: {
        enrollmentId: enrollment.id,
        wave: 1,
        sentAt: new Date(),
        replyWindowEndsAt: new Date(2026, 10, 3),
      },
    })

    const [card] = await progressCards(orgSlug)

    expect(card).toMatchObject({
      title: 'Your civic panel is filling up',
      summary:
        '12 of 100 residents have joined. More invites go out Tuesday, November 3.',
      ctaLabel: 'See your panel',
      ctaHref: '/dashboard/contacts/citizens-panel',
      sourceItemId: 'building',
    })
    expect(card?.summary.split(' ').length).toBeLessThanOrEqual(20)
    expect(await progressCards(orgSlug)).toHaveLength(1)
  })

  it('says invites are paused on a paused panel', async () => {
    const orgSlug = 'eo-progress-paused'
    await seedElectedOffice(orgSlug)
    await seedEnrollment(orgSlug)
    await setPanel(orgSlug, { status: ManagedCivicPanelStatus.paused })

    const [card] = await progressCards(orgSlug)

    expect(card?.summary).toBe(
      '0 of 100 residents have joined. Invites are paused.',
    )
  })

  it('becomes the ready card, even after the building card was set aside', async () => {
    const orgSlug = 'eo-progress-ready'
    const eo = await seedElectedOffice(orgSlug)
    await seedEnrollment(orgSlug)
    const [building] = await progressCards(orgSlug)
    if (!building) throw new Error('no building card')
    await act(orgSlug, building.id, 'dismiss')
    await joinMembers(orgSlug, 100)
    await setPanel(orgSlug, {
      status: ManagedCivicPanelStatus.ready,
      readyAt: new Date(),
    })

    const cards = await progressCards(orgSlug)

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: 'Your civic panel is ready',
      summary:
        '100 residents said yes. Ask them what they think before your next vote.',
      sourceItemId: 'ready',
    })
    expect(
      await service.prisma.dashboardCard.count({
        where: { electedOfficeId: eo.id, sourceItemId: 'building' },
      }),
    ).toBe(0)
  })

  it('takes the ready card away two weeks after the panel was ready', async () => {
    const orgSlug = 'eo-progress-ready-old'
    await seedElectedOffice(orgSlug)
    await seedEnrollment(orgSlug)
    await setPanel(orgSlug, {
      status: ManagedCivicPanelStatus.ready,
      readyAt: subDays(new Date(), 15),
    })

    expect(await progressCards(orgSlug)).toHaveLength(0)
  })

  it('offers the join link once everyone a text can reach was invited', async () => {
    const orgSlug = 'eo-progress-exhausted'
    await seedElectedOffice(orgSlug)
    await seedEnrollment(orgSlug)
    await setPanel(orgSlug, { status: ManagedCivicPanelStatus.exhausted })

    const [card] = await progressCards(orgSlug)

    expect(card).toMatchObject({
      title: 'Fill the last seats on your civic panel',
      ctaLabel: 'Get your join link',
      sourceItemId: 'exhausted',
    })
    expect(card?.summary.split(' ').length).toBeLessThanOrEqual(20)
  })

  it('goes once the office stops its panel', async () => {
    const orgSlug = 'eo-progress-stopped'
    await seedElectedOffice(orgSlug)
    await seedEnrollment(orgSlug)
    expect(await progressCards(orgSlug)).toHaveLength(1)

    await setPanel(orgSlug, { status: ManagedCivicPanelStatus.stopped })

    expect(await progressCards(orgSlug)).toHaveLength(0)
  })

  it('is never made or listed with serve-citizen-panels off', async () => {
    const orgSlug = 'eo-progress-flag-off'
    const eo = await seedElectedOffice(orgSlug)
    await seedEnrollment(orgSlug)
    isFeatureEnabled.mockResolvedValue(false)

    expect(await progressCards(orgSlug)).toHaveLength(0)
    expect(
      await service.prisma.dashboardCard.count({
        where: { electedOfficeId: eo.id },
      }),
    ).toBe(0)
  })
})
