import { Inject, Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { getTime, isAfter, max, subHours, subMinutes } from 'date-fns'
import { Organization, Prisma, PriorityAnswerCode } from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { frameAnswersNeeded } from '@/contacts/utils/civicPanelAllocation.util'
import { JobsService } from '@/jobs/jobs.service'
import type { JobRun } from '@/jobs/jobs.registry'
import type { PersonAnswer } from '@/peopleDb/databricks/districtCensusSql.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { MrpFrameTooLargeError } from '../util/mrp.util'
import { estimateMrpOnThread } from '../util/mrp.thread'
import type { MrpRead } from '../util/mrpReadStatus.util'
import { PRIORITY_UNSENT_STATUSES } from '../util/priorityRespondents.util'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from './censusComposition'

// Part of every stored read's inputsKey. Bump it with any change to the
// model, the frame or how a read is built, so every stored read refreshes on
// its next view.
const MRP_READ_VERSION = 2

// A read the daily refresh leaves alone. Under a day, so the daily run
// always takes yesterday's reads, and long enough that the refresh a reader
// queued beside a coding pass's does not fit twice.
const FRESH_HOURS = 20

// A stored "no read" (a district the warehouse did not give, or none) is
// tried again on a view this long after, not only on the daily run.
const NO_READ_RETRY_MINUTES = 60

// How long a stored read stands before a refresh may compute it again.
const freshSince = (read: MrpRead | null | undefined, now: Date): Date =>
  read ? subHours(now, FRESH_HOURS) : subMinutes(now, NO_READ_RETRY_MINUTES)

// A mixed answer is half a yes; an answer that is no answer sits out.
const YES_SHARE: Record<PriorityAnswerCode, number | null> = {
  [PriorityAnswerCode.yes]: 1,
  [PriorityAnswerCode.no]: 0,
  [PriorityAnswerCode.mixed]: 0.5,
  [PriorityAnswerCode.not_an_answer]: null,
}

// A priority's coded answers, one per person, and a key that changes when
// any of them does.
interface CodedAnswers {
  answers: PersonAnswer[]
  key: string
}

const inputsKeyOf = (coded: CodedAnswers | undefined): string =>
  `${MRP_READ_VERSION}:${coded?.key ?? 'none'}`

// A priority's read of its coded answers against the district, computed in
// the background (the priorityReadRefresh job) and stored, so no request
// ever fits the model. Every surface reads the stored row; one whose inputs
// have moved on is served as it is while a refresh is queued.
@Injectable()
export class PriorityReadService extends createPrismaBase(MODELS.PriorityRead) {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly jobs: JobsService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
  ) {
    super()
  }

  // Each priority's stored read, null before its first refresh lands or
  // when the district could not be read. Any that is missing or stale gets
  // a refresh queued. The caller has already scoped the ids to the office.
  async readsFor(
    organizationSlug: string,
    priorityIds: string[],
  ): Promise<Map<string, MrpRead | null>> {
    if (priorityIds.length === 0) return new Map()
    const [coded, rows] = await Promise.all([
      this.codedAnswers(organizationSlug, priorityIds),
      this.model.findMany({
        where: { priorityId: { in: priorityIds } },
        select: {
          priorityId: true,
          inputsKey: true,
          read: true,
          computedAt: true,
        },
      }),
    ])
    const now = new Date()
    const stored = new Map(rows.map((row) => [row.priorityId, row]))
    const stale = priorityIds.flatMap((priorityId) => {
      const inputsKey = inputsKeyOf(coded.get(priorityId))
      const row = stored.get(priorityId)
      if (row?.inputsKey === inputsKey) {
        if (row.read !== null || isAfter(row.computedAt, freshSince(null, now)))
          return []
        return [
          {
            data: { priorityId },
            key: `${priorityId}:${inputsKey}:${getTime(row.computedAt)}`,
            group: priorityId,
          },
        ]
      }
      return [
        {
          data: { priorityId },
          key: `${priorityId}:${inputsKey}`,
          group: priorityId,
        },
      ]
    })
    if (stale.length > 0) {
      // A read is served whether or not its refresh could be queued: the
      // next view queues it again.
      await this.jobs
        .sendMany('priorityReadRefresh', stale)
        .catch((err: Error) =>
          this.logger.error(
            { err, priorityIds: stale.map(({ data }) => data.priorityId) },
            'Could not queue priority read refreshes',
          ),
        )
    }
    return new Map(
      priorityIds.map((priorityId) => [
        priorityId,
        stored.get(priorityId)?.read ?? null,
      ]),
    )
  }

  // After answers on a priority were coded. Grouped by priority, so its
  // refreshes run one at a time in the order they were queued.
  async queueRefresh(priorityId: string): Promise<void> {
    await this.jobs.send(
      'priorityReadRefresh',
      { priorityId },
      { group: priorityId },
    )
  }

  // The priorityReadRefreshDaily schedule's worker. What a read stands on
  // also changes without a new answer: the district's people and census
  // (rebuilt in the warehouse) and the office's district. A day old is
  // fresh enough for both.
  async fanOutDaily(): Promise<void> {
    const now = new Date()
    const due = await this.model.findMany({
      where: {
        computedAt: { lt: subHours(now, FRESH_HOURS) },
        priority: { archivedAt: null },
      },
      select: { priorityId: true },
    })
    const day = now.toISOString().slice(0, 10)
    await this.jobs.sendMany(
      'priorityReadRefresh',
      due.map(({ priorityId }) => ({
        data: { priorityId },
        key: `${priorityId}:${day}`,
        group: priorityId,
      })),
    )
  }

  // The priorityReadRefresh job's worker: reads the priority's answers as
  // they are now, so running it twice stores the same read.
  async refresh(job: JobRun<{ priorityId: string }>): Promise<void> {
    const { priorityId } = job.data
    const priority = await this.client.priority.findUnique({
      where: { id: priorityId },
      select: {
        electedOffice: { select: { organization: true } },
        mrpRead: { select: { inputsKey: true, read: true, computedAt: true } },
      },
    })
    if (priority === null) return
    const { organization } = priority.electedOffice
    const coded = (
      await this.codedAnswers(organization.slug, [priorityId])
    ).get(priorityId)
    const inputsKey = inputsKeyOf(coded)
    const now = new Date()
    if (
      priority.mrpRead?.inputsKey === inputsKey &&
      isAfter(
        priority.mrpRead.computedAt,
        freshSince(priority.mrpRead.read, now),
      )
    ) {
      return
    }

    const read = await this.computeRead(organization, coded?.answers ?? [], job)
    const stored = {
      inputsKey,
      read: read ?? Prisma.DbNull,
      computedAt: now,
    }
    await this.model.upsert({
      where: { priorityId },
      create: { priorityId, ...stored },
      update: stored,
    })
  }

  private async computeRead(
    organization: Organization,
    answers: PersonAnswer[],
    job: JobRun<{ priorityId: string }>,
  ): Promise<MrpRead | null> {
    // No district is a read with no census, like a failed one.
    const district = await this.resolveContacts()
      .resolveEligibleDistrict(organization)
      .catch(() => null)
    if (!district) return null
    const inputs = await this.census.mrpInputs({ ...district, answers })
    if (!inputs) {
      // Most often a warehouse that did not answer: retried, and stored as
      // no read only once the attempts are spent.
      if (job.retryCount < job.retryLimit) {
        throw new Error('The district could not be read for the model')
      }
      return null
    }
    try {
      const result = await estimateMrpOnThread(
        inputs.answers,
        inputs.frame,
        job.signal,
      )
      return {
        result,
        raceNameable: inputs.raceNameable,
        answersNeeded: frameAnswersNeeded(inputs.frame),
      }
    } catch (err) {
      if (!(err instanceof MrpFrameTooLargeError)) throw err
      // The district's areas keep every real frame under the caps, so one
      // past them is a bug to look at, not a district to expect.
      this.logger.error(
        {
          err,
          organizationSlug: organization.slug,
          priorityId: job.data.priorityId,
        },
        'district frame too large for the model; reading the count alone',
      )
      return null
    }
  }

  // The coded answers on the sends PriorityResultsService counts, per
  // priority. A person who answered on more than one send counts once, their
  // answers averaged.
  private async codedAnswers(
    organizationSlug: string,
    priorityIds: string[],
  ): Promise<Map<string, CodedAnswers>> {
    const rows = await this.client.priorityAnswer.findMany({
      where: {
        organizationSlug,
        code: { not: PriorityAnswerCode.not_an_answer },
        outreach: {
          priorityId: { in: priorityIds },
          organizationSlug,
          campaignId: null,
          status: { notIn: PRIORITY_UNSENT_STATUSES },
        },
      },
      select: {
        personId: true,
        code: true,
        codedAt: true,
        outreach: { select: { priorityId: true } },
      },
    })
    const byPriority = new Map<string, typeof rows>()
    for (const row of rows) {
      const { priorityId } = row.outreach
      if (priorityId === null) continue
      byPriority.set(priorityId, [...(byPriority.get(priorityId) ?? []), row])
    }
    return new Map(
      [...byPriority].map(([priorityId, answers]) => {
        const byPerson = new Map<string, number[]>()
        for (const { personId, code } of answers) {
          const yes = YES_SHARE[code]
          if (yes === null) continue
          byPerson.set(personId, [...(byPerson.get(personId) ?? []), yes])
        }
        const latest = max(answers.map(({ codedAt }) => codedAt))
        return [
          priorityId,
          {
            answers: [...byPerson].map(([personId, shares]) => ({
              personId,
              yes:
                shares.reduce((sum, share) => sum + share, 0) / shares.length,
            })),
            key: `${answers.length}:${getTime(latest)}`,
          },
        ]
      }),
    )
  }

  // Resolved lazily: importing ContactsModule here closes the module cycle
  // through Campaigns that organizationTeam.service.ts describes.
  private resolveContacts(): ContactsService {
    return this.moduleRef.get(ContactsService, { strict: false })
  }
}
