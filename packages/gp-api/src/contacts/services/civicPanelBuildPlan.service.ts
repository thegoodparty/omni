import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  answersNeeded,
  BUILD_CITIZENS_PANEL_PURPOSE,
  panelExpectedAnswers,
  panelGoalMembers,
  PANEL_ACTIVE_WINDOW_DAYS,
  PANEL_STEP_WINDOW_DAYS,
  PANEL_TEXT_REPLY_BUSINESS_DAYS,
  UnderrepresentedGroupSchema,
  type CivicPanelBuildPlanResponse,
  type CivicPanelComposition,
  type PrepareCivicPanelBuildStepResponse,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import { addBusinessDays, addDays, isBefore, parseISO, subDays } from 'date-fns'
import {
  CivicPanelBuildChannel,
  CivicPanelBuildPlanStatus,
  CivicPanelStatus,
  ContactStatusField,
  Organization,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import {
  EVENTS,
  type SegmentTrackEventProperties,
} from 'src/vendors/segment/segment.types'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { UNSENT_OUTREACH_STATUSES } from '@/outreach/util/unsentOutreachStatuses.util'
import { answeredPersonIds } from '@/priorities/util/priorityRespondents.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import {
  areaAround,
  CHANNEL_ORDER,
  nextStep,
  sizePanelWave,
  stepStatus,
  waveIsDue,
  type PanelWavePools,
} from '../utils/civicPanelBuild.util'
import {
  civicPanelInviteCriteria,
  civicPanelInviteListName,
  inviteLean,
  NOT_YET_ASKED,
} from '../utils/civicPanelInvite.util'
import {
  panelSteering,
  precinctPlaces,
  type PanelMix,
  type PanelSteering,
} from '../utils/civicPanelSteering.util'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { ContactsService } from './contacts.service'
import { CensusTractNameService } from './censusTractName.service'

// The purpose the standard flow opens on: every channel's civic panel
// invite. A text asks with the locked JOIN line; a call or a door with the
// join question the official records.
const FLOW_PURPOSES: Record<CivicPanelBuildChannel, string> = {
  text: BUILD_CITIZENS_PANEL_PURPOSE,
  phone_banking: BUILD_CITIZENS_PANEL_PURPOSE,
  door_knocking: BUILD_CITIZENS_PANEL_PURPOSE,
}

const STEP_SELECT = {
  id: true,
  wave: true,
  channel: true,
  position: true,
  targetSize: true,
  voterFileFilterId: true,
  outreachId: true,
  phoneBankingListId: true,
  doorKnockingTurfId: true,
  startedAt: true,
  completedAt: true,
  expectedRepliesBy: true,
  skippedAt: true,
  markedDone: true,
  markedAt: true,
  steeredToward: true,
  landlineFirst: true,
} satisfies Prisma.CivicPanelBuildStepSelect

type StepRow = Prisma.CivicPanelBuildStepGetPayload<{
  select: typeof STEP_SELECT
}>

type PlanRow = Prisma.CivicPanelBuildPlanGetPayload<{
  include: { steps: { select: typeof STEP_SELECT } }
}>

type Office = { id: string; organizationSlug: string }

// Where the official answered the weekly time question.
export type CivicPanelPlanSurface = 'panel_page' | 'chief_of_staff'

// A panel's census read is kept this long per set of members, so the plan
// page, its cards and the Chief of Staff do not each re-read the warehouse.
const MIX_CACHE_MS = 15 * 60 * 1000

const storedLean = (value: string | null): UnderrepresentedGroup | null => {
  const parsed = UnderrepresentedGroupSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

type StepLinks = Partial<
  Pick<
    StepRow,
    | 'outreachId'
    | 'phoneBankingListId'
    | 'doorKnockingTurfId'
    | 'startedAt'
    | 'completedAt'
    | 'expectedRepliesBy'
  >
>

const LINK_KEYS = [
  'outreachId',
  'phoneBankingListId',
  'doorKnockingTurfId',
  'startedAt',
  'completedAt',
  'expectedRepliesBy',
] as const

// A step as its list reads, with the official's own tick or untick over
// it: ticked, it is done when it was ticked (or when its list finished);
// unticked, it is not done whatever its list says.
const withMark = <
  T extends Pick<StepRow, 'completedAt' | 'markedDone' | 'markedAt'>,
>(
  step: T,
): T => {
  if (step.markedDone === true) {
    return { ...step, completedAt: step.completedAt ?? step.markedAt }
  }
  if (step.markedDone === false) return { ...step, completedAt: null }
  return step
}

// Serve's plan to build the civic panel across texts, calls and doors, in
// waves. The official answers one question (hours each week); every size
// and every status follows from it and from what has actually been sent,
// called and knocked. See the contacts AGENTS.md, "Building the panel across
// channels".
@Injectable()
export class CivicPanelBuildPlanService extends createPrismaBase(
  MODELS.CivicPanelBuildPlan,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly contactStatusService: ContactStatusService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly analytics: AnalyticsService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
    private readonly voterQuery: VoterQueryService,
    private readonly tractNames: CensusTractNameService,
  ) {
    super()
  }

  private track(
    office: Office,
    events: [string, SegmentTrackEventProperties][],
  ): Promise<void> {
    return trackForOffice(
      this.client,
      this.analytics,
      { id: office.id },
      events,
    )
  }

  private readonly mixes = new Map<
    string,
    { key: string; mix: PanelMix; expiresAt: number }
  >()

  async create(
    organization: Organization,
    hoursPerWeek: number,
    surface: CivicPanelPlanSurface,
  ): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
    if (await this.findActive(office.id)) {
      throw new ConflictException('This office already has a panel plan')
    }
    const memberIds = await this.memberIds(organization)
    const members = memberIds.size
    const planGoal = panelGoalMembers(
      await this.districtAnswersNeeded(organization),
    )
    const keepFresh = members >= planGoal
    const gap = keepFresh
      ? this.keepFreshGap(await this.steeringFor(organization, memberIds, true))
      : planGoal - members
    const steps = sizePanelWave({
      gap,
      hoursPerWeek,
      pools: await this.pools(organization),
    })
    if (steps.length === 0) {
      throw new ConflictException(
        'Everyone we can reach has already been invited',
      )
    }
    let planId: string
    try {
      planId = await this.client.$transaction(async (tx) => {
        await this.lockOffice(tx, office.id)
        const active = await tx.civicPanelBuildPlan.findFirst({
          where: {
            electedOfficeId: office.id,
            status: CivicPanelBuildPlanStatus.active,
          },
          select: { id: true },
        })
        if (active) {
          throw new ConflictException('This office already has a panel plan')
        }
        const plan = await tx.civicPanelBuildPlan.create({
          data: {
            electedOfficeId: office.id,
            organizationSlug: office.organizationSlug,
            goalMembers: planGoal,
            keepFresh,
            hoursPerWeek,
            steps: { create: steps.map((step) => ({ ...step, wave: 1 })) },
          },
          select: { id: true },
        })
        return plan.id
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('This office already has a panel plan')
      }
      throw error
    }
    const stepsOn = (channel: CivicPanelBuildChannel) =>
      steps.filter((step) => step.channel === channel).length
    await this.track(office, [
      [
        EVENTS.CivicPanel.PlanCreated,
        {
          planId,
          hoursPerWeek,
          goalMembers: planGoal,
          membersAtStart: members,
          stepCount: steps.length,
          textSteps: stepsOn(CivicPanelBuildChannel.text),
          callSteps: stepsOn(CivicPanelBuildChannel.phone_banking),
          doorSteps: stepsOn(CivicPanelBuildChannel.door_knocking),
          surface,
        },
      ],
    ])
    return this.read(organization, { nameTracts: true })
  }

  // A new answer to the weekly time question. Only waves made from now on
  // are sized from it: the current wave's lists may already be drawn or
  // worked.
  async updateHours(
    organization: Organization,
    hoursPerWeek: number,
    surface: CivicPanelPlanSurface,
  ): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
    const before = await this.findActive(office.id)
    const updated = await this.model.updateMany({
      where: {
        electedOfficeId: office.id,
        status: CivicPanelBuildPlanStatus.active,
      },
      data: { hoursPerWeek },
    })
    if (updated.count === 0) {
      throw new NotFoundException('This office has no panel plan to change')
    }
    if (before && before.hoursPerWeek !== hoursPerWeek) {
      await this.track(office, [
        [
          EVENTS.CivicPanel.PlanUpdated,
          {
            planId: before.id,
            fromHours: before.hoursPerWeek,
            toHours: hoursPerWeek,
            surface,
          },
        ],
      ])
    }
    return this.read(organization, { nameTracts: true })
  }

  // The official sets a step aside. Only a step of the current wave that
  // nothing was started from; the wave then stops waiting on it.
  async skip(
    organization: Organization,
    stepId: string,
  ): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
    const step = await this.client.civicPanelBuildStep.findFirst({
      where: { id: stepId, plan: { electedOfficeId: office.id } },
      select: {
        ...STEP_SELECT,
        plan: {
          select: { status: true, steps: { select: { wave: true } } },
        },
      },
    })
    if (!step) throw new NotFoundException('Step not found')
    const currentWave = Math.max(...step.plan.steps.map((s) => s.wave))
    if (
      step.plan.status !== CivicPanelBuildPlanStatus.active ||
      step.wave < currentWave
    ) {
      throw new ConflictException('This step is no longer part of the plan')
    }
    if (step.startedAt || step.completedAt) {
      throw new ConflictException('This step has already started')
    }
    if (!step.skippedAt) {
      const skipped = await this.client.civicPanelBuildStep.updateMany({
        where: { id: step.id, startedAt: null, skippedAt: null },
        data: { skippedAt: new Date() },
      })
      if (skipped.count > 0) {
        await this.track(office, [
          [
            EVENTS.CivicPanel.StepSkipped,
            { stepId: step.id, channel: step.channel, wave: step.wave },
          ],
        ])
      }
    }
    return this.read(organization, { nameTracts: true })
  }

  // The official ticks a call or door step done, or unticks it, over what
  // its list says. A text checks itself once it is sent.
  async mark(
    organization: Organization,
    stepId: string,
    done: boolean,
  ): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
    const step = await this.client.civicPanelBuildStep.findFirst({
      where: { id: stepId, plan: { electedOfficeId: office.id } },
      select: {
        id: true,
        wave: true,
        channel: true,
        skippedAt: true,
        startedAt: true,
        completedAt: true,
        markedDone: true,
        plan: { select: { status: true } },
      },
    })
    if (!step) throw new NotFoundException('Step not found')
    if (step.plan.status !== CivicPanelBuildPlanStatus.active) {
      throw new ConflictException('This step is no longer part of the plan')
    }
    if (step.channel === CivicPanelBuildChannel.text) {
      throw new BadRequestException('A text step is done once it is sent')
    }
    // A skip only holds while nothing was started from the step, the same
    // as its status reads.
    if (step.skippedAt && !step.startedAt) {
      throw new ConflictException('This step was skipped')
    }
    await this.client.civicPanelBuildStep.update({
      where: { id: step.id },
      data: { markedDone: done, markedAt: new Date() },
    })
    // A step's completion is reported once: here, or by the read when its
    // list finished first.
    if (done && step.markedDone !== true && !step.completedAt) {
      await this.track(office, [
        [
          EVENTS.CivicPanel.StepCompleted,
          {
            stepId: step.id,
            channel: step.channel,
            wave: step.wave,
            how: 'marked',
          },
        ],
      ])
    }
    return this.read(organization, { nameTracts: true })
  }

  // The plan as it stands. Reading it is what moves it: an active plan's
  // goal is brought to the district's (see goalFor), step links and dates
  // are refreshed from the sends, call lists and walks, the plan closes once
  // the panel reaches its goal, and the next wave is made once the current
  // one is due.
  async read(
    organization: Organization,
    { nameTracts = false }: { nameTracts?: boolean } = {},
  ): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
    const memberIds = await this.memberIds(organization)
    const members = memberIds.size
    const needed = await this.districtAnswersNeeded(organization)
    const districtGoal = panelGoalMembers(needed)
    const steering = await this.steeringFor(
      organization,
      memberIds,
      members >= districtGoal,
    )
    const active = await this.findActive(office.id)
    if (active) {
      const goalMembers = active.keepFresh
        ? active.goalMembers
        : this.goalFor(active.goalMembers, districtGoal, members)
      if (goalMembers !== active.goalMembers) {
        await this.model.updateMany({
          where: { id: active.id, status: CivicPanelBuildPlanStatus.active },
          data: { goalMembers },
        })
      }
      await this.advance(
        organization,
        office,
        { ...active, goalMembers },
        members,
        steering,
      )
    }
    const plan = await this.model.findFirst({
      where: { electedOfficeId: office.id },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      include: { steps: { select: STEP_SELECT } },
    })
    const composition = await this.withTractNames(
      organization,
      await this.compositionFor(organization, memberIds, steering),
      nameTracts,
    )
    const progressToward = (goal: number) => ({
      members,
      goal,
      answersNeeded: needed,
      expectedAnswers: panelExpectedAnswers(members),
      groupsCovered: steering.coverage?.groupsCovered ?? 0,
      groupsTotal: steering.coverage?.groupsTotal ?? 0,
    })
    const goal =
      plan?.status === CivicPanelBuildPlanStatus.active && !plan.keepFresh
        ? plan.goalMembers
        : districtGoal
    if (!plan) {
      return {
        plan: null,
        next: null,
        progress: progressToward(districtGoal),
        balance: steering.balance,
        composition,
      }
    }
    const now = new Date()
    const currentWave = Math.max(1, ...plan.steps.map((s) => s.wave))
    const steps = await Promise.all(
      plan.steps
        .map(withMark)
        .sort((a, b) => a.wave - b.wave || this.stepOrder(a, b))
        .map(async (step) => {
          const status = stepStatus(step, step.wave < currentWave, now)
          return {
            ...step,
            status,
            steeredToward:
              step.voterFileFilterId !== null
                ? storedLean(step.steeredToward)
                : status === 'not_started'
                  ? inviteLean(step.channel, steering)
                  : null,
            landlineFirst:
              step.channel !== CivicPanelBuildChannel.phone_banking
                ? null
                : step.voterFileFilterId !== null
                  ? // Drawn before this was recorded: only a draw that
                    // dropped landlines first could lean.
                    (step.landlineFirst ?? step.steeredToward === null)
                  : status === 'not_started'
                    ? steering.landlineFirst
                    : null,
            ...(await this.reachOf(organization, step, memberIds)),
          }
        }),
    )
    return {
      plan: {
        id: plan.id,
        status: plan.status,
        goalMembers: plan.goalMembers,
        keepFresh: plan.keepFresh,
        hoursPerWeek: plan.hoursPerWeek,
        currentWave,
        createdAt: plan.createdAt,
        completedAt: plan.completedAt,
        steps,
      },
      next:
        plan.status === CivicPanelBuildPlanStatus.active
          ? nextStep(steps.filter((s) => s.wave === currentWave))
          : null,
      progress: progressToward(goal),
      balance: steering.balance,
      composition,
    }
  }

  // Draws the step's people and saves them as a list the standard flow
  // opens on. Idempotent: a prepared step returns the list it already drew.
  async prepare(
    organization: Organization,
    stepId: string,
  ): Promise<PrepareCivicPanelBuildStepResponse> {
    const office = await this.officeFor(organization)
    const step = await this.client.civicPanelBuildStep.findFirst({
      where: { id: stepId, plan: { electedOfficeId: office.id } },
      select: {
        ...STEP_SELECT,
        plan: {
          select: {
            status: true,
            goalMembers: true,
            keepFresh: true,
            steps: { select: { wave: true } },
          },
        },
      },
    })
    if (!step) throw new NotFoundException('Step not found')
    // Its people went back to later draws when it was skipped.
    if (step.skippedAt) {
      throw new ConflictException('This step was skipped')
    }
    if (step.voterFileFilterId !== null) {
      return this.prepared(organization, step, step.voterFileFilterId)
    }
    const currentWave = Math.max(...step.plan.steps.map((s) => s.wave))
    if (
      step.plan.status !== CivicPanelBuildPlanStatus.active ||
      step.wave < currentWave
    ) {
      throw new ConflictException('This step is no longer part of the plan')
    }
    const exclude = await this.excludedPersonIds(organization)
    const steering = await this.steeringFor(
      organization,
      await this.memberIds(organization),
      step.plan.keepFresh,
    )
    const { personIds, steeredToward } = await this.draw(
      organization,
      step,
      exclude,
      steering,
    )
    if (personIds.length === 0) {
      throw new ConflictException('Nobody is left to invite this way')
    }
    const list = await this.voterFileFilterService.create(
      organization.slug,
      {
        ...civicPanelInviteCriteria(step.channel),
        name: civicPanelInviteListName(step),
        sample: { size: personIds.length },
        civicPanelInvite: true,
      },
      null,
      personIds,
    )
    const claimed = await this.client.civicPanelBuildStep.updateMany({
      where: { id: step.id, voterFileFilterId: null },
      data: {
        voterFileFilterId: list.id,
        preparedAt: new Date(),
        steeredToward,
        landlineFirst:
          step.channel === CivicPanelBuildChannel.phone_banking
            ? steering.landlineFirst
            : null,
      },
    })
    if (claimed.count === 0) {
      // A second press drew too; the first list is the step's.
      await this.client.voterFileFilter.delete({ where: { id: list.id } })
      const winner = await this.client.civicPanelBuildStep.findUniqueOrThrow({
        where: { id: step.id },
        select: STEP_SELECT,
      })
      if (winner.voterFileFilterId === null) {
        throw new ConflictException('This step could not be prepared')
      }
      return this.prepared(organization, winner, winner.voterFileFilterId)
    }
    return this.prepared(organization, step, list.id)
  }

  private async prepared(
    organization: Organization,
    step: StepRow,
    voterFileFilterId: number,
  ): Promise<PrepareCivicPanelBuildStepResponse> {
    const personIds = await this.samplePersonIds(voterFileFilterId)
    const area =
      step.channel === CivicPanelBuildChannel.door_knocking
        ? areaAround(
            (
              await this.contactsService.pointsForPeople(
                personIds,
                organization,
              )
            ).points,
          )
        : null
    return {
      stepId: step.id,
      channel: step.channel,
      voterFileFilterId,
      purpose: FLOW_PURPOSES[step.channel],
      size: personIds.length,
      area,
    }
  }

  private async advance(
    organization: Organization,
    office: Office,
    plan: PlanRow,
    members: number,
    steering: PanelSteering,
  ): Promise<void> {
    const now = new Date()
    for (const step of plan.steps) {
      // A skipped step stays skipped: its list is not read back into it,
      // so its people stay free for later draws.
      if (
        step.voterFileFilterId === null ||
        step.completedAt ||
        step.skippedAt
      ) {
        continue
      }
      await this.syncStep(
        organization,
        office,
        step,
        step.voterFileFilterId,
        now,
      )
    }
    if (!plan.keepFresh && members >= plan.goalMembers) {
      const closed = await this.model.updateMany({
        where: { id: plan.id, status: CivicPanelBuildPlanStatus.active },
        data: {
          status: CivicPanelBuildPlanStatus.completed,
          completedAt: now,
        },
      })
      if (closed.count > 0) {
        await this.track(office, [
          [
            EVENTS.CivicPanel.GoalReached,
            {
              planId: plan.id,
              members,
              goalMembers: plan.goalMembers,
              waves: Math.max(1, ...plan.steps.map((s) => s.wave)),
            },
          ],
        ])
      }
      return
    }
    const synced = await this.client.civicPanelBuildStep.findMany({
      where: { planId: plan.id },
      select: STEP_SELECT,
    })
    const currentWave = Math.max(...synced.map((s) => s.wave))
    const wave = synced
      .filter((s) => s.wave === currentWave)
      .map(withMark)
      .map((s) => ({ ...s, status: stepStatus(s, false, now) }))
    if (!waveIsDue(wave, now)) return
    // Sized before the lock: the counts are people-db reads, too slow to
    // hold a transaction open for. The lock only settles who writes.
    const steps = sizePanelWave({
      gap: plan.keepFresh
        ? this.keepFreshGap(steering)
        : plan.goalMembers - members,
      hoursPerWeek: plan.hoursPerWeek,
      pools: await this.pools(organization),
    })
    await this.client.$transaction(async (tx) => {
      await this.lockOffice(tx, office.id)
      const latest = await tx.civicPanelBuildStep.aggregate({
        where: { planId: plan.id },
        _max: { wave: true },
      })
      const fresh = await tx.civicPanelBuildPlan.findUniqueOrThrow({
        where: { id: plan.id },
        select: { status: true, hoursPerWeek: true },
      })
      // A weekly time changed since the sizing read leaves the wave to the
      // next read, which sizes it from the new time.
      if (
        latest._max.wave !== currentWave ||
        fresh.status !== CivicPanelBuildPlanStatus.active ||
        fresh.hoursPerWeek !== plan.hoursPerWeek
      ) {
        return
      }
      if (steps.length === 0) {
        await tx.civicPanelBuildPlan.update({
          where: { id: plan.id },
          data: {
            status: CivicPanelBuildPlanStatus.exhausted,
            completedAt: now,
          },
        })
        return
      }
      await tx.civicPanelBuildStep.createMany({
        data: steps.map((step) => ({
          ...step,
          planId: plan.id,
          wave: currentWave + 1,
        })),
      })
    })
  }

  // Writes what the step's list has become: the send, call list or walk
  // made from it, when it started, when replies are due, and once it is
  // done, when.
  private async syncStep(
    organization: Organization,
    office: Office,
    step: StepRow,
    voterFileFilterId: number,
    now: Date,
  ): Promise<void> {
    const data =
      step.channel === CivicPanelBuildChannel.text
        ? await this.textTimeline(organization, voterFileFilterId, now)
        : step.channel === CivicPanelBuildChannel.phone_banking
          ? await this.callTimeline(organization, voterFileFilterId, now)
          : await this.doorTimeline(voterFileFilterId, now)
    if (!data) return
    const changed = LINK_KEYS.some((key) => {
      if (!(key in data)) return false
      const before = step[key]
      const after = data[key]
      return before instanceof Date && after instanceof Date
        ? before.getTime() !== after.getTime()
        : before !== after
    })
    if (!changed) return
    // Conditional on the start and finish this read saw, so of two reads
    // racing over the same step only one records (and reports) the change.
    const written = await this.client.civicPanelBuildStep.updateMany({
      where: {
        id: step.id,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      },
      data,
    })
    if (written.count === 0) return
    const events: [string, SegmentTrackEventProperties][] = []
    const base = { stepId: step.id, channel: step.channel, wave: step.wave }
    if (!step.startedAt && data.startedAt) {
      events.push([EVENTS.CivicPanel.StepStarted, base])
    }
    // A ticked or unticked step reads off the official's mark, so its list
    // finishing is not a completion (mark reported the tick).
    if (!step.completedAt && data.completedAt && step.markedDone === null) {
      events.push([
        EVENTS.CivicPanel.StepCompleted,
        {
          ...base,
          how:
            data.completedAt.getTime() === now.getTime()
              ? 'finished'
              : 'window_ended',
        },
      ])
    }
    await this.track(office, events)
  }

  private async textTimeline(
    organization: Organization,
    voterFileFilterId: number,
    now: Date,
  ): Promise<StepLinks | null> {
    const send = await this.client.outreach.findFirst({
      where: {
        organizationSlug: organization.slug,
        voterFileFilterId,
        outreachType: OutreachType.text,
        status: { notIn: UNSENT_OUTREACH_STATUSES },
      },
      orderBy: { createdAt: Prisma.SortOrder.asc },
      select: {
        id: true,
        status: true,
        createdAt: true,
        date: true,
        scheduledLocalDate: true,
      },
    })
    if (!send) return null
    const sendsOn = send.scheduledLocalDate
      ? parseISO(send.scheduledLocalDate)
      : (send.date ?? send.createdAt)
    const expectedRepliesBy = addBusinessDays(
      sendsOn,
      PANEL_TEXT_REPLY_BUSINESS_DAYS,
    )
    const completedAt =
      send.status === OutreachStatus.completed
        ? now
        : isBefore(now, expectedRepliesBy)
          ? null
          : expectedRepliesBy
    return {
      outreachId: send.id,
      startedAt: send.createdAt,
      expectedRepliesBy,
      completedAt,
    }
  }

  private async callTimeline(
    organization: Organization,
    voterFileFilterId: number,
    now: Date,
  ): Promise<StepLinks | null> {
    const list = await this.client.phoneBankingList.findFirst({
      where: { organizationSlug: organization.slug, voterFileFilterId },
      orderBy: { createdAt: Prisma.SortOrder.asc },
      select: {
        id: true,
        createdAt: true,
        outreach: { select: { id: true, status: true } },
      },
    })
    if (!list) return null
    const [called, target] = await Promise.all([
      this.client.contactInteractionPhoneBanking.count({
        where: { phoneBankingListId: list.id },
      }),
      this.client.voterFileFilterSampleMember.count({
        where: { voterFileFilterId },
      }),
    ])
    const done =
      list.outreach?.status === OutreachStatus.completed || called >= target
    return {
      phoneBankingListId: list.id,
      outreachId: list.outreach?.id ?? null,
      startedAt: list.createdAt,
      completedAt: this.doneAt(done, list.createdAt, now),
    }
  }

  private async doorTimeline(
    voterFileFilterId: number,
    now: Date,
  ): Promise<StepLinks | null> {
    const turfs = await this.client.doorKnockingTurf.findMany({
      where: { voterFileFilterId, deletedAt: null },
      orderBy: { createdAt: Prisma.SortOrder.asc },
      select: {
        id: true,
        createdAt: true,
        outreach: { select: { id: true, status: true } },
      },
    })
    const [first] = turfs
    if (!first) return null
    const envelopes = turfs.flatMap((turf) =>
      turf.outreach ? [turf.outreach] : [],
    )
    const [knocked, target] = await Promise.all([
      this.client.contactInteractionDoorKnock.groupBy({
        by: ['personId'],
        where: { outreachId: { in: envelopes.map((e) => e.id) } },
      }),
      this.client.voterFileFilterSampleMember.count({
        where: { voterFileFilterId },
      }),
    ])
    const done =
      (envelopes.length > 0 &&
        envelopes.every((e) => e.status === OutreachStatus.completed)) ||
      knocked.length >= target
    return {
      doorKnockingTurfId: first.id,
      outreachId: first.outreach?.id ?? null,
      startedAt: first.createdAt,
      completedAt: this.doneAt(done, first.createdAt, now),
    }
  }

  // Done now, or done when its window ran out, or not done yet.
  private doneAt(done: boolean, startedAt: Date, now: Date): Date | null {
    if (done) return now
    const windowEnds = addDays(startedAt, PANEL_STEP_WINDOW_DAYS)
    return isBefore(now, windowEnds) ? null : windowEnds
  }

  // Texts, and calls once the panel holds its share of people 65 and over,
  // are weighted draws toward the groups the panel trails. Doors walk the
  // part of the district the panel has reached least, when it holds a
  // step's worth of households.
  private async draw(
    organization: Organization,
    step: StepRow,
    exclude: string[],
    steering: PanelSteering,
  ): Promise<{
    personIds: string[]
    steeredToward: UnderrepresentedGroup | null
  }> {
    const weighted = async (seedKey: string) => ({
      personIds:
        (await this.contactsService.drawListSample(
          organization,
          civicPanelInviteCriteria(step.channel),
          {
            size: step.targetSize,
            seedKey,
            excludePersonIds: exclude,
            weights: steering.weights ?? undefined,
          },
        )) ?? [],
      steeredToward: inviteLean(step.channel, steering),
    })
    if (step.channel === CivicPanelBuildChannel.text) {
      return weighted(step.id)
    }
    if (step.channel === CivicPanelBuildChannel.phone_banking) {
      if (!steering.landlineFirst) return weighted(`${step.id}:any`)
      // Landlines first: the residents a text cannot reach. Anyone else
      // with a phone fills what is left.
      const landlines =
        (await this.contactsService.drawListSample(
          organization,
          { ...NOT_YET_ASKED, hasLandline: true },
          {
            size: step.targetSize,
            seedKey: `${step.id}:landline`,
            excludePersonIds: exclude,
          },
        )) ?? []
      const short = step.targetSize - landlines.length
      if (short <= 0) return { personIds: landlines, steeredToward: null }
      const others =
        (await this.contactsService.drawListSample(
          organization,
          civicPanelInviteCriteria(step.channel),
          {
            size: short,
            seedKey: `${step.id}:any`,
            excludePersonIds: [...exclude, ...landlines],
          },
        )) ?? []
      return { personIds: [...landlines, ...others], steeredToward: null }
    }
    if (steering.doorTract) {
      const inTract = await this.contactsService.walkableAreaWithin(
        organization,
        civicPanelInviteCriteria(step.channel),
        exclude,
        step.targetSize,
        steering.doorTract,
      )
      if (inTract.length >= step.targetSize) {
        return {
          personIds: inTract.flatMap((household) => household.personIds),
          steeredToward: 'unreachedAreas',
        }
      }
    }
    const area = await this.contactsService.walkableAreaWithin(
      organization,
      civicPanelInviteCriteria(step.channel),
      exclude,
      step.targetSize,
    )
    return {
      personIds: area.flatMap((household) => household.personIds),
      steeredToward: null,
    }
  }

  // The answers a good read of the district needs, enough for every major
  // group to answer three times. A district that cannot be read is sized for
  // the smallest major group any district can have.
  private async districtAnswersNeeded(
    organization: Organization,
  ): Promise<number> {
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      return (
        (await this.census.districtAnswersNeeded(district)) ?? answersNeeded()
      )
    } catch {
      return answersNeeded()
    }
  }

  // Which groups the panel covers, and how the next draws lean. A panel
  // with nobody on it has no census to read, and a failed read leans nowhere.
  // Past its goal (`pastGoal`) the panel is judged on its active members.
  private async steeringFor(
    organization: Organization,
    memberIds: Set<string>,
    pastGoal = false,
  ): Promise<PanelSteering> {
    const members = memberIds.size
    const mix =
      members === 0
        ? null
        : await this.mixOf(organization, [...memberIds], 'members')
    return panelSteering({
      members,
      mix,
      activeMix:
        pastGoal && mix
          ? await this.activeMixOf(organization, memberIds, mix)
          : null,
    })
  }

  // The panel page's seats and petals: by tract from the census, or by
  // precinct when the district has no tract data. Null when neither can be
  // read.
  private async compositionFor(
    organization: Organization,
    memberIds: Set<string>,
    steering: PanelSteering,
  ): Promise<CivicPanelComposition | null> {
    const fromCensus = steering.composition
    if (fromCensus && fromCensus.places.length > 0) return fromCensus
    if (memberIds.size === 0) return null
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      const [precincts, members] = await Promise.all([
        this.voterQuery.findPrecincts(district.districtId, district.dataset),
        this.voterQuery.findPrecinctMembers(
          district.districtId,
          district.dataset,
          [...memberIds],
        ),
      ])
      const places = precinctPlaces(
        precincts.options.map(({ county, precinct, voters }) => ({
          county,
          precinct,
          people: voters,
        })),
        members,
      )
      if (places.length === 0) return fromCensus
      return {
        placeKind: 'precinct',
        places,
        groups: fromCensus?.groups ?? [],
      }
    } catch {
      return fromCensus
    }
  }

  // Each tract's human name where it has one. A plan write also names the
  // tracts that have none, after its response: Geoapify is never called on
  // a read, and never twice for a tract (CensusTractNameService).
  private async withTractNames(
    organization: Organization,
    composition: CivicPanelComposition | null,
    nameTracts: boolean,
  ): Promise<CivicPanelComposition | null> {
    if (composition?.placeKind !== 'tract') return composition
    const tracts = composition.places.map((place) => place.key)
    if (nameTracts) {
      void this.contactsService
        .resolveEligibleDistrict(organization)
        .then((district) => this.tractNames.fillMissing(district, tracts))
        .catch(() => undefined)
    }
    try {
      const labels = await this.tractNames.labelsFor(tracts)
      return {
        ...composition,
        places: composition.places.map((place) => {
          const label = labels.get(place.key)
          return label ? { ...place, label } : place
        }),
      }
    } catch {
      return composition
    }
  }

  // The members who answered a priority's text, call or door in the last
  // PANEL_ACTIVE_WINDOW_DAYS, counted the way the members are. Nobody active
  // is the census with no one on it.
  private async activeMixOf(
    organization: Organization,
    memberIds: Set<string>,
    memberMix: PanelMix,
  ): Promise<PanelMix | null> {
    const answered = await answeredPersonIds(
      this.client,
      organization.slug,
      null,
      subDays(new Date(), PANEL_ACTIVE_WINDOW_DAYS),
    )
    const active = answered.filter((personId) => memberIds.has(personId))
    if (active.length === 0) return { cells: [], census: memberMix.census }
    return this.mixOf(organization, active, 'active')
  }

  // The members a keep-fresh wave is sized to: the fewest that would put
  // every group at its active members. Null with nobody short, so the wave
  // is the official's hours alone.
  private keepFreshGap(steering: PanelSteering): number | null {
    const short = steering.fresh?.membersShort ?? 0
    return short > 0 ? short : null
  }

  private async mixOf(
    organization: Organization,
    personIds: string[],
    scope: 'members' | 'active',
  ): Promise<PanelMix | null> {
    const key = createHash('sha256')
      .update([...personIds].sort().join(','))
      .digest('hex')
    const now = Date.now()
    const cacheKey = `${organization.slug}:${scope}`
    const cached = this.mixes.get(cacheKey)
    if (cached && cached.key === key && cached.expiresAt > now) {
      return cached.mix
    }
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      const mix = await this.census.weightingInputs({ ...district, personIds })
      if (mix) {
        this.mixes.set(cacheKey, {
          key,
          mix,
          expiresAt: now + MIX_CACHE_MS,
        })
      }
      return mix
    } catch {
      return null
    }
  }

  // How many each channel can still reach.
  private async pools(organization: Organization): Promise<PanelWavePools> {
    const exclude = await this.excludedPersonIds(organization)
    const count = (channel: CivicPanelBuildChannel) =>
      this.contactsService.countWithin(
        organization,
        civicPanelInviteCriteria(channel),
        exclude,
      )
    return {
      text: await count(CivicPanelBuildChannel.text),
      phone: await count(CivicPanelBuildChannel.phone_banking),
      door: await count(CivicPanelBuildChannel.door_knocking),
    }
  }

  // Who no step may draw: anyone an earlier step of any of the office's
  // plans already drew (unless it was skipped untouched), and anyone who
  // opted out of the office's texts.
  // Members, people who left, anyone already invited and anyone reached in
  // the rest window are left out by every step list's own criteria.
  private async excludedPersonIds(
    organization: Organization,
  ): Promise<string[]> {
    const [drawn, optedOut] = await Promise.all([
      this.client.voterFileFilterSampleMember.findMany({
        where: {
          voterFileFilter: {
            organizationSlug: organization.slug,
            // A step skipped before anything was started from it gives its
            // people back to later draws.
            civicPanelBuildStep: {
              is: { OR: [{ skippedAt: null }, { startedAt: { not: null } }] },
            },
          },
        },
        select: { personId: true },
      }),
      this.contactInteractionTextService.findOptedOutPersonIds(
        organization.slug,
      ),
    ])
    return [...new Set([...drawn.map((row) => row.personId), ...optedOut])]
  }

  private async samplePersonIds(voterFileFilterId: number): Promise<string[]> {
    const rows = await this.client.voterFileFilterSampleMember.findMany({
      where: { voterFileFilterId },
      select: { personId: true },
    })
    return rows.map((row) => row.personId)
  }

  private async memberIds(organization: Organization): Promise<Set<string>> {
    const members = await this.contactStatusService.personIdsByFieldValue(
      organization.slug,
      ContactStatusField.civic_panel,
      [CivicPanelStatus.member],
    )
    return new Set(members)
  }

  // Who a step reached and who it brought in: the residents called or
  // knocked (a text has no count of its own here), and the residents its
  // list drew who are on the panel now.
  private async reachOf(
    organization: Organization,
    step: StepRow,
    memberIds: Set<string>,
  ): Promise<{ reached: number | null; joined: number | null }> {
    if (step.voterFileFilterId === null) return { reached: null, joined: null }
    const drawn = await this.samplePersonIds(step.voterFileFilterId)
    const joined = drawn.filter((id) => memberIds.has(id)).length
    if (step.channel === CivicPanelBuildChannel.phone_banking) {
      if (step.phoneBankingListId === null) return { reached: null, joined }
      const called = await this.client.contactInteractionPhoneBanking.groupBy({
        by: ['personId'],
        where: {
          organizationSlug: organization.slug,
          phoneBankingListId: step.phoneBankingListId,
        },
      })
      return { reached: called.length, joined }
    }
    if (step.channel === CivicPanelBuildChannel.door_knocking) {
      const turfs = await this.client.doorKnockingTurf.findMany({
        where: { voterFileFilterId: step.voterFileFilterId, deletedAt: null },
        select: { outreach: { select: { id: true } } },
      })
      const envelopes = turfs.flatMap((t) =>
        t.outreach ? [t.outreach.id] : [],
      )
      if (envelopes.length === 0) return { reached: null, joined }
      const knocked = await this.client.contactInteractionDoorKnock.groupBy({
        by: ['personId'],
        where: { outreachId: { in: envelopes } },
      })
      return { reached: knocked.length, joined }
    }
    return { reached: null, joined }
  }

  // An active plan's goal follows the district's, so plans made under an
  // older sizing and plans whose district mix moved read the same as a new
  // one. It may come down, but never below the members the panel already
  // has: the plan then completes rather than reading as past its goal.
  private goalFor(
    planGoal: number,
    districtGoal: number,
    members: number,
  ): number {
    if (districtGoal >= planGoal) return districtGoal
    return Math.max(districtGoal, members)
  }

  private findActive(electedOfficeId: string): Promise<PlanRow | null> {
    return this.model.findFirst({
      where: { electedOfficeId, status: CivicPanelBuildPlanStatus.active },
      include: { steps: { select: STEP_SELECT } },
    })
  }

  private async officeFor(organization: Organization): Promise<Office> {
    const office = organization.slug.startsWith('eo-')
      ? await this.client.electedOffice.findUnique({
          where: { organizationSlug: organization.slug },
          select: { id: true, organizationSlug: true },
        })
      : null
    if (!office) {
      throw new BadRequestException(
        'The civic panel is not available for this organization',
      )
    }
    return office
  }

  private lockOffice(tx: Prisma.TransactionClient, electedOfficeId: string) {
    const lockKey = `civic_panel_plan:${electedOfficeId}`
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
  }

  private stepOrder(
    a: { channel: CivicPanelBuildChannel; position: number },
    b: { channel: CivicPanelBuildChannel; position: number },
  ): number {
    return (
      CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel) ||
      a.position - b.position
    )
  }
}
