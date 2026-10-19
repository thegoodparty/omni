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
  PANEL_MIN_MEMBERS_FOR_BALANCE,
  PANEL_STEP_WINDOW_DAYS,
  PANEL_TEXT_REPLY_BUSINESS_DAYS,
  UnderrepresentedGroupSchema,
  type CivicPanelBuildPlanResponse,
  type PrepareCivicPanelBuildStepResponse,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import { addBusinessDays, addDays, isBefore, parseISO } from 'date-fns'
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
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { UNSENT_OUTREACH_STATUSES } from '@/outreach/util/unsentOutreachStatuses.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import {
  areaAround,
  CHANNEL_ORDER,
  nextStep,
  pickWalkableArea,
  sizePanelWave,
  stepStatus,
  waveIsDue,
  type PanelWavePools,
} from '../utils/civicPanelBuild.util'
import {
  panelSteering,
  type PanelMix,
  type PanelSteering,
} from '../utils/civicPanelSteering.util'
import { ContactsService } from './contacts.service'

// Every list a step draws is never invited to the panel and not reached in
// the rest window; the channel adds the reach it needs.
const NOT_YET_ASKED = {
  civicPanelNeverInvited: true,
  notContactedRecently: true,
} as const

const LIST_NAMES: Record<CivicPanelBuildChannel, string> = {
  text: 'Civic panel invite',
  phone_banking: 'Civic panel calls',
  door_knocking: 'Civic panel doors',
}

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
} satisfies Prisma.CivicPanelBuildStepSelect

type StepRow = Prisma.CivicPanelBuildStepGetPayload<{
  select: typeof STEP_SELECT
}>

type PlanRow = Prisma.CivicPanelBuildPlanGetPayload<{
  include: { steps: { select: typeof STEP_SELECT } }
}>

type Office = { id: string; organizationSlug: string }

// A panel's census read is kept this long per set of members, so the plan
// page, its cards and the Chief of Staff do not each re-read the warehouse.
const MIX_CACHE_MS = 15 * 60 * 1000

// What a step's draw would lean toward with the panel as it stands. Doors
// lean only once their tract is known to hold enough doors, at the draw.
const predictedLean = (
  channel: CivicPanelBuildChannel,
  steering: PanelSteering,
): UnderrepresentedGroup | null => {
  if (channel === CivicPanelBuildChannel.door_knocking) {
    return steering.doorTract ? 'unreachedAreas' : null
  }
  if (!steering.weights) return null
  if (channel === CivicPanelBuildChannel.phone_banking) {
    return steering.landlineFirst ? null : steering.leansToward
  }
  return steering.leansToward
}

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
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
  ) {
    super()
  }

  private readonly mixes = new Map<
    string,
    { key: string; mix: PanelMix; expiresAt: number }
  >()

  async create(
    organization: Organization,
    hoursPerWeek: number,
  ): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
    if (await this.findActive(office.id)) {
      throw new ConflictException('This office already has a panel plan')
    }
    const members = await this.memberCount(organization)
    const goalMembers = panelGoalMembers(
      await this.contactsService.getDistrictPopulation(organization),
    )
    const gap = goalMembers - members
    if (gap <= 0) {
      throw new ConflictException(
        'Your civic panel has already reached its goal',
      )
    }
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
    try {
      await this.client.$transaction(async (tx) => {
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
        await tx.civicPanelBuildPlan.create({
          data: {
            electedOfficeId: office.id,
            organizationSlug: office.organizationSlug,
            goalMembers,
            hoursPerWeek,
            steps: { create: steps.map((step) => ({ ...step, wave: 1 })) },
          },
        })
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('This office already has a panel plan')
      }
      throw error
    }
    return this.read(organization)
  }

  // A new answer to the weekly time question. Only waves made from now on
  // are sized from it: the current wave's lists may already be drawn or
  // worked.
  async updateHours(
    organization: Organization,
    hoursPerWeek: number,
  ): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
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
    return this.read(organization)
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
      await this.client.civicPanelBuildStep.updateMany({
        where: { id: step.id, startedAt: null, skippedAt: null },
        data: { skippedAt: new Date() },
      })
    }
    return this.read(organization)
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
        channel: true,
        skippedAt: true,
        startedAt: true,
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
    return this.read(organization)
  }

  // The plan as it stands. Reading it is what moves it: an active plan's
  // goal is brought to the district's (see goalFor), step links and dates
  // are refreshed from the sends, call lists and walks, the plan closes once
  // the panel reaches its goal, and the next wave is made once the current
  // one is due.
  async read(organization: Organization): Promise<CivicPanelBuildPlanResponse> {
    const office = await this.officeFor(organization)
    const memberIds = await this.memberIds(organization)
    const members = memberIds.size
    const population =
      await this.contactsService.getDistrictPopulation(organization)
    const needed = answersNeeded(population)
    const districtGoal = panelGoalMembers(population)
    const active = await this.findActive(office.id)
    if (active) {
      const goalMembers = this.goalFor(
        active.goalMembers,
        districtGoal,
        members,
      )
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
      )
    }
    const plan = await this.model.findFirst({
      where: { electedOfficeId: office.id },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      include: { steps: { select: STEP_SELECT } },
    })
    const progressToward = (goal: number) => ({
      members,
      goal,
      answersNeeded: needed,
      expectedAnswers: panelExpectedAnswers(members),
    })
    const goal =
      plan?.status === CivicPanelBuildPlanStatus.active
        ? plan.goalMembers
        : districtGoal
    const steering = await this.steeringFor(organization, memberIds, goal)
    if (!plan) {
      return {
        plan: null,
        next: null,
        progress: progressToward(districtGoal),
        balance: steering.balance,
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
                  ? predictedLean(step.channel, steering)
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
      step.plan.goalMembers,
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
        ...this.criteriaFor(step.channel),
        name: this.listName(step),
        sample: { size: personIds.length },
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
      await this.syncStep(organization, step, step.voterFileFilterId, now)
    }
    if (members >= plan.goalMembers) {
      await this.model.updateMany({
        where: { id: plan.id, status: CivicPanelBuildPlanStatus.active },
        data: {
          status: CivicPanelBuildPlanStatus.completed,
          completedAt: now,
        },
      })
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
      gap: plan.goalMembers - members,
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
    await this.client.civicPanelBuildStep.update({
      where: { id: step.id },
      data,
    })
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
          this.criteriaFor(step.channel),
          {
            size: step.targetSize,
            seedKey,
            excludePersonIds: exclude,
            weights: steering.weights ?? undefined,
          },
        )) ?? [],
      steeredToward: predictedLean(step.channel, steering),
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
          this.criteriaFor(step.channel),
          {
            size: short,
            seedKey: `${step.id}:any`,
            excludePersonIds: [...exclude, ...landlines],
          },
        )) ?? []
      return { personIds: [...landlines, ...others], steeredToward: null }
    }
    if (steering.doorTract) {
      const inTract = await this.contactsService.doorPointsWithin(
        organization,
        this.criteriaFor(step.channel),
        exclude,
        steering.doorTract,
      )
      const households = new Set(inTract.map((point) => point.addressKey))
      if (households.size >= step.targetSize) {
        return {
          personIds: pickWalkableArea(inTract, step.targetSize).flatMap(
            (household) => household.personIds,
          ),
          steeredToward: 'unreachedAreas',
        }
      }
    }
    const points = await this.contactsService.doorPointsWithin(
      organization,
      this.criteriaFor(step.channel),
      exclude,
    )
    return {
      personIds: pickWalkableArea(points, step.targetSize).flatMap(
        (household) => household.personIds,
      ),
      steeredToward: null,
    }
  }

  // How the panel compares with its district, and how the next draws lean.
  // The census is read only from PANEL_MIN_MEMBERS_FOR_BALANCE members up,
  // and a failed read leans nowhere.
  private async steeringFor(
    organization: Organization,
    memberIds: Set<string>,
    goal: number,
  ): Promise<PanelSteering> {
    const members = memberIds.size
    if (members < PANEL_MIN_MEMBERS_FOR_BALANCE) {
      return panelSteering({ members, goal, mix: null })
    }
    return panelSteering({
      members,
      goal,
      mix: await this.mixOf(organization, [...memberIds]),
    })
  }

  private async mixOf(
    organization: Organization,
    personIds: string[],
  ): Promise<PanelMix | null> {
    const key = createHash('sha256')
      .update([...personIds].sort().join(','))
      .digest('hex')
    const now = Date.now()
    const cached = this.mixes.get(organization.slug)
    if (cached && cached.key === key && cached.expiresAt > now) {
      return cached.mix
    }
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      const mix = await this.census.weightingInputs({ ...district, personIds })
      if (mix) {
        this.mixes.set(organization.slug, {
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

  private criteriaFor(channel: CivicPanelBuildChannel) {
    return channel === CivicPanelBuildChannel.text
      ? { ...NOT_YET_ASKED, hasCellPhone: true }
      : channel === CivicPanelBuildChannel.phone_banking
        ? { ...NOT_YET_ASKED, hasAnyPhone: true }
        : { ...NOT_YET_ASKED }
  }

  private listName(step: StepRow): string {
    const base = LIST_NAMES[step.channel]
    const area = step.position > 1 ? ` ${step.position}` : ''
    const round = step.wave > 1 ? `, round ${step.wave}` : ''
    return `${base}${area}${round}`
  }

  // How many each channel can still reach.
  private async pools(organization: Organization): Promise<PanelWavePools> {
    const exclude = await this.excludedPersonIds(organization)
    const count = (channel: CivicPanelBuildChannel) =>
      this.contactsService.countWithin(
        organization,
        this.criteriaFor(channel),
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

  private async memberCount(organization: Organization): Promise<number> {
    return (await this.memberIds(organization)).size
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

  // An active plan's goal follows the district's, so plans made before the
  // goal was sized in answers (100 members) and plans whose census figure
  // moved read the same as a new one. It may come down, but never below the
  // members the panel already has: the plan then completes rather than
  // reading as past its goal.
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
