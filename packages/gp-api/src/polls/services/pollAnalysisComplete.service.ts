import { APIPollStatus, derivePollStatus } from '@/polls/polls.types'
import { isHighConfidence } from '@goodparty_org/contracts'
import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { PollIndividualMessageSender, Prisma } from '@/generated/prisma'
import { groupBy } from 'es-toolkit'
import pmap from 'p-map'
import { serializeError } from 'serialize-error'
import { v5 as uuidv5 } from 'uuid'
import { PinoLogger } from 'nestjs-pino'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { HubspotSingleSendService } from '@/crm/hubspotSingleSend.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { OrgDistrict } from '@/organizations/organizations.types'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  PollAnalysisCompleteEvent,
  PollClusterAnalysisJsonSchema,
} from '@/queue/queue.types'
import { normalizePhoneNumber } from '@/shared/util/strings.util'
import { UsersService } from '@/users/services/users.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { POLL_INDIVIDUAL_MESSAGE_NAMESPACE } from '../utils/polls.utils'
import { PollIndividualMessageService } from './pollIndividualMessage.service'
import { PollIssuesService } from './pollIssues.service'
import { PollsService } from './polls.service'

type PollAnalysisIssue = PollAnalysisCompleteEvent['data']['issues'][number]

// One poll can have hundreds of unmapped response phones, each resolved via an
// HTTP POST to People-API. Firing them all at once (Promise.all) overruns
// People-API's request/socket budget and cascades into timeouts and failures.
// A benchmark modelling that downstream
// showed a cap of 20 eliminates the errors while being at least as fast as the
// unbounded burst at typical poll sizes (the burst pays a degradation penalty),
// so we bound the fan-out here.
const PEOPLE_LOOKUP_CONCURRENCY = 20

// Unset in every environment today — Ops has not yet created the poll
// results single-send email asset in HubSpot (ENG-11035). Read live rather
// than cached at module load, mirroring HUBSPOT_PIN_SENT_EMAIL_ID, so a prod
// cutover needs no redeploy. Until it's set, the existing Segment-event ->
// HubSpot workflow email path is unchanged.
const getPollResultsSingleSendEmailId = (): number | null => {
  const raw = process.env.HUBSPOT_POLL_RESULTS_EMAIL_ID
  const emailId = raw ? Number(raw) : NaN
  return Number.isFinite(emailId) ? emailId : null
}

const buildIssueProperties = (
  issue: PollAnalysisIssue | undefined,
  index: number,
): Record<string, string | number | null> => {
  if (!issue) {
    return {
      [`issue${index}Description`]: null,
      [`issue${index}Quote1`]: null,
      [`issue${index}Quote2`]: null,
      [`issue${index}Quote3`]: null,
      [`issue${index}MentionCount`]: null,
    }
  }
  return {
    [`issue${index}Description`]: issue.summary,
    [`issue${index}Quote1`]: issue.quotes[0]?.quote ?? '',
    [`issue${index}Quote2`]: issue.quotes[1]?.quote ?? '',
    [`issue${index}Quote3`]: issue.quotes[2]?.quote ?? '',
    [`issue${index}MentionCount`]: issue.responseCount,
  }
}

@Injectable()
export class PollAnalysisCompleteService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly pollsService: PollsService,
    private readonly pollIssuesService: PollIssuesService,
    private readonly pollIndividualMessage: PollIndividualMessageService,
    private readonly electedOfficeService: ElectedOfficeService,
    private readonly contactsService: ContactsService,
    private readonly s3Service: S3Service,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly hubspotSingleSend: HubspotSingleSendService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PollAnalysisCompleteService.name)
  }

  async handlePollAnalysisComplete(
    data: PollAnalysisCompleteEvent['data'],
  ): Promise<void> {
    const {
      pollId,
      totalResponses,
      responsesLocation,
      issues,
      promptSource,
      promptFallbackReason,
    } = data
    this.logger.info(`Handling poll analysis complete event for poll ${pollId}`)
    if (promptSource === 'fallback') {
      this.logger.warn(
        { pollId, promptFallbackReason },
        'Synthesis run used the in-repo theme prompt',
      )
    }
    const found = await this.getPollAndOrganization(pollId)
    if (!found) {
      this.logger.info('Poll not found, ignoring event')
      return
    }
    const { poll, office, organization } = found
    const { electedOfficeId } = poll

    if (!electedOfficeId) {
      throw new InternalServerErrorException(
        `Error: pollId ${pollId} has no elected office`,
      )
    }

    // We want to allow completing scheduled polls for testing purposes. In E2E tests
    // we create polls and want to simulate completing them quickly.
    if (
      ![APIPollStatus.SCHEDULED, APIPollStatus.IN_PROGRESS].includes(
        derivePollStatus(poll),
      )
    ) {
      this.logger.info(
        {
          poll,
        },
        'Poll is not in expected state, ignoring event',
      )
      return
    }

    const constituency = await this.contactsService.findContacts(
      { segment: 'all', resultsPerPage: 5, page: 1 },
      organization,
    )

    let highConfidence = false
    if (constituency.pagination.totalResults) {
      // This was last decided here: https://goodparty.clickup.com/t/90132012119/ENG-4771
      highConfidence = isHighConfidence({
        replies: totalResponses,
        population: constituency.pagination.totalResults,
      })
    }

    await this.pollIssuesService.model.deleteMany({
      where: { pollId },
    })
    this.logger.info('Successfully deleted existing poll issues')

    const issuesToWrite = issues.map((issue) => ({
      id: `${pollId}-${issue.rank}`,
      pollId,
      title: issue.theme,
      summary: issue.summary,
      details: issue.analysis,
      mentionCount: issue.responseCount,
      representativeComments: issue.quotes.map((quote) => ({
        quote: quote.quote,
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    await this.pollIssuesService.client.pollIssue.createMany({
      data: issuesToWrite,
    })
    this.logger.info('Successfully created new poll issues')
    const bucket = process.env.SERVE_ANALYSIS_BUCKET_NAME
    if (!bucket) {
      throw new Error('Please set SERVE_ANALYSIS_BUCKET_NAME in your .env')
    }
    const responsesFileContent = await this.s3Service.getFile(
      bucket,
      responsesLocation,
    )
    if (!responsesFileContent) {
      throw new InternalServerErrorException(
        `Unable to fetch responses from S3 for pollId: ${pollId}`,
      )
    }
    const rows = PollClusterAnalysisJsonSchema.parse(
      JSON.parse(responsesFileContent),
    )
    // One response can span multiple rows / elements in the array (one per atomic message)
    // and there may be duplicate rows
    const groups = groupBy(
      rows,
      (r) => `${r.phoneNumber}\n${r.receivedAt ?? ''}`,
    )

    const phoneNumbers = Array.from(
      new Set(rows.map((r) => normalizePhoneNumber(r.phoneNumber))),
    )
    const phoneToPersonIdMap = await this.findMappedPersonIdsForCellPhones({
      electedOfficeId,
      pollId,
      phoneNumbers,
    })

    // Some response phones won't appear in this poll's outreach map — most
    // often because the original recipient forwarded the SMS and somebody
    // else replied. Try to resolve those phones in the org's district via
    // the People DB so we can still attribute the response to a real
    // constituent. Anything still unresolved after this is skipped (logged)
    // rather than thrown, to avoid poison-pilling the entire poll's
    // analysis on a single unattributable reply.
    const unmappedPhones = phoneNumbers.filter(
      (p) => !phoneToPersonIdMap.has(p),
    )
    if (unmappedPhones.length > 0) {
      this.logger.info(
        { pollId, unmappedPhoneCount: unmappedPhones.length },
        "Some response phones weren't in this poll's outreach; trying People DB fallback",
      )
      // Pro-access depends only on `organization` (constant across this loop),
      // so resolve it once instead of letting every findPersonByPhone re-query
      // the campaign. Bound the fan-out (see PEOPLE_LOOKUP_CONCURRENCY) so a
      // large poll can't burst hundreds of simultaneous requests at People-API.
      const [proAccess, dataset] = await Promise.all([
        this.contactsService.resolveProAccess(organization),
        this.contactsService.resolvePeopleDataset(organization),
      ])
      const lookups = await pmap(
        unmappedPhones,
        async (normalized) => {
          const digitsOnly = normalized.replace(/^\+1/, '')
          try {
            const person = await this.contactsService.findPersonByPhone(
              digitsOnly,
              organization,
              proAccess,
              dataset,
            )
            return { phone: normalized, personId: person?.id ?? null }
          } catch (err) {
            this.logger.warn(
              { err: serializeError(err), phone: normalized, pollId },
              'People DB lookup failed for unmapped poll phone',
            )
            return { phone: normalized, personId: null }
          }
        },
        { concurrency: PEOPLE_LOOKUP_CONCURRENCY },
      )
      for (const { phone, personId } of lookups) {
        if (personId) phoneToPersonIdMap.set(phone, personId)
      }
    }

    const scalarData: Prisma.PollIndividualMessageCreateManyInput[] = []
    const joinValues: Prisma.Sql[] = []

    for (const [, groupRows] of Object.entries(groups)) {
      const first = groupRows[0]
      if (!first) continue
      const { phoneNumber, originalMessage, receivedAt } = first
      const isOptOut = groupRows.some((r) => Boolean(r.isOptOut))
      const hasClusterId = groupRows.some(
        (r) => r.clusterId !== '' && r.clusterId != null,
      )

      // Discard responses that have no cluster assignment, unless they are opt-outs
      if (!hasClusterId && !isOptOut) continue

      const normalizedPhone = normalizePhoneNumber(phoneNumber)
      const personId = phoneToPersonIdMap.get(normalizedPhone)
      if (!personId) {
        // Throwing here would fail the job on every retry and dead-letter
        // it, so *no* valid response for this poll would ever be
        // persisted. A single
        // unattributable reply is the lesser evil — drop the row, keep a
        // record in the logs, and let the rest of the analysis through.
        this.logger.warn(
          { pollId, phoneNumber: normalizedPhone, isOptOut },
          'Skipping poll response: phone not in outreach and not found in People DB',
        )
        continue
      }

      const uuid = uuidv5(
        `${pollId}-${personId}-${receivedAt}`,
        POLL_INDIVIDUAL_MESSAGE_NAMESPACE,
      )
      const sentAt = receivedAt ? new Date(receivedAt) : new Date()

      scalarData.push({
        id: uuid,
        personId,
        personCellPhone: normalizedPhone,
        sentAt,
        isOptOut,
        sender: PollIndividualMessageSender.CONSTITUENT,
        content: originalMessage,
        electedOfficeId,
        pollId,
      })

      // Only link to poll issues that exist in the event data (i.e. the top 3 clusters).
      // Multiple responses can also have the same cluster
      // Responses with a clusterId outside the top 3 still get saved above, just without a link.
      const linkedIssues = issuesToWrite.filter((issue) =>
        groupRows.some((row) => row.theme === issue.title),
      )
      for (const issue of linkedIssues) {
        joinValues.push(Prisma.sql`(${uuid}, ${issue.id})`)
      }
    }

    // Idempotency: delete constituent responses we're about to replace (same deterministic ids).
    // Does not touch ELECTED_OFFICIAL messages (outreach); join rows removed by FK CASCADE.
    const idsToReplace = scalarData.map((d) => d.id)
    const prisma = this.pollIndividualMessage.client
    await prisma.$transaction(
      async (tx) => {
        await tx.pollIndividualMessage.deleteMany({
          where: {
            id: { in: idsToReplace },
            pollId,
            sender: PollIndividualMessageSender.CONSTITUENT,
          },
        })
        await tx.pollIndividualMessage.createMany({ data: scalarData })
        if (joinValues.length > 0) {
          await tx.$executeRaw`
          INSERT INTO "_PollIndividualMessageToPollIssue" ("A", "B")
          VALUES ${Prisma.join(joinValues, ', ')}
        `
        }
      },
      { timeout: 20000 },
    )

    this.logger.info(
      `Created individual messages for poll ${pollId} (linked issues: ${joinValues.length})`,
    )

    await this.pollsService.markPollComplete({
      pollId,
      totalResponses,
      confidence: highConfidence ? 'HIGH' : 'LOW',
    })

    const pollCount = await this.pollsService.model.count({
      where: {
        electedOfficeId,
        isCompleted: true,
      },
    })

    let district: OrgDistrict | null = null
    try {
      district = await this.organizationsService.getDistrictForOrgSlug(
        organization.slug,
      )
    } catch (e) {
      this.logger.warn(
        { e },
        'Failed to fetch district for analytics, defaulting to null',
      )
    }

    try {
      await Promise.all([
        this.analytics.identify(office.userId, { pollcount: pollCount }),
        this.analytics.track(
          office.userId,
          EVENTS.Polls.ResultsSynthesisCompleted,
          {
            pollId,
            path: `/dashboard/polls/${pollId}`,
            constituencyName: district?.l2Name,
            'issue 1': issues?.at(0)?.theme || null,
            'issue 2': issues?.at(1)?.theme || null,
            'issue 3': issues?.at(2)?.theme || null,
            ...buildIssueProperties(issues?.at(0), 1),
            ...buildIssueProperties(issues?.at(1), 2),
            ...buildIssueProperties(issues?.at(2), 3),
            pollsSent: poll.targetAudienceSize,
            pollResponses: totalResponses,
            pollResponseRate:
              totalResponses > 0
                ? `${((totalResponses / poll.targetAudienceSize) * 100).toFixed(1)}%`
                : '0%',
          },
        ),
      ])
    } catch (err) {
      this.logger.error(
        { err, pollId },
        'Failed to track analytics for Poll Results Synthesis Completed',
      )
    }

    await this.sendPollResultsSingleSend(office.userId, pollId)
  }

  // The email leg of this notification moves to a direct HubSpot single-send
  // call (ENG-11035) — recipient is the elected official the poll belongs
  // to, not whatever email a HubSpot workflow would resolve off the contact
  // record. Reuses the existing "Serve - Transactional Email - Results
  // Ready" asset as-is (per HUBSPOT_INTEGRATION.md); the Segment event above
  // keeps firing unchanged for non-email consumers. A single-send failure
  // must never throw here — the poll is already marked complete, and a
  // retry of the job would not get past the poll status check above.
  private async sendPollResultsSingleSend(
    officeUserId: number,
    pollId: string,
  ): Promise<void> {
    const emailId = getPollResultsSingleSendEmailId()
    if (!emailId) {
      this.logger.debug(
        'HUBSPOT_POLL_RESULTS_EMAIL_ID not set — skipping HubSpot ' +
          'single-send; the workflow email path still covers this notification',
      )
      return
    }
    try {
      const user = await this.usersService.findUnique({
        where: { id: officeUserId },
      })
      if (!user) {
        this.logger.warn(
          { officeUserId, pollId },
          'Poll results single-send skipped: office user not found',
        )
        return
      }
      await this.hubspotSingleSend.sendSingleSend({
        emailId,
        to: user.email,
        customProperties: {
          poll_id: pollId,
          path: `/dashboard/polls/${pollId}`,
        },
      })
    } catch (err) {
      this.logger.error(
        { err, pollId },
        'HubSpot single-send failed for Poll Results Ready; the workflow ' +
          'email path still fires from the Segment event',
      )
    }
  }

  private async getPollAndOrganization(pollId: string) {
    const poll = await this.pollsService.findUnique({
      where: { id: pollId },
    })
    if (!poll) {
      this.logger.info('Poll not found, ignoring event')
      return
    }

    if (!poll.electedOfficeId) {
      this.logger.info('Poll has no elected office, ignoring event')
      return
    }

    const office =
      await this.electedOfficeService.client.electedOffice.findUnique({
        where: { id: poll.electedOfficeId },
        include: { organization: true },
      })

    if (!office) {
      this.logger.info('Elected office not found, ignoring event')
      return
    }

    const organization = office.organization
    if (!organization) {
      this.logger.info('Elected office has no organization, ignoring event')
      return
    }

    return { poll, office, organization }
  }

  async findMappedPersonIdsForCellPhones(params: {
    electedOfficeId: string
    pollId: string
    phoneNumbers: string[]
  }) {
    const { electedOfficeId, pollId, phoneNumbers } = params
    const cellPhonesToPeopleIds: Map<string, string> = new Map()
    const messages = await this.pollIndividualMessage.findMany({
      where: {
        electedOfficeId,
        pollId,
        personCellPhone: { in: phoneNumbers },
        sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
      },
    })
    for (const message of messages) {
      const { personCellPhone, personId } = message
      if (!personCellPhone) {
        throw new InternalServerErrorException(
          'Encountered unexpected message without a cellphone',
        )
      }
      cellPhonesToPeopleIds.set(normalizePhoneNumber(personCellPhone), personId)
    }
    return cellPhonesToPeopleIds
  }
}
