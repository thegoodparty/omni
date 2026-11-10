import { Injectable } from '@nestjs/common'
import { format, isBefore } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import parseCsv from 'neat-csv'
import { Poll, PollIndividualMessageSender, Prisma } from '@/generated/prisma'
import type { JobRun } from '@/jobs/jobs.registry'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { PersonOutput } from '@/contacts/schemas/person.schema'
import { SampleContacts } from '@/contacts/schemas/sampleContacts.schema'
import { ContactsService } from '@/contacts/services/contacts.service'
import { csvEscape } from '@/shared/util/csv.util'
import { normalizePhoneNumber } from '@/shared/util/strings.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { sendTevynAPIPollMessage } from '../utils/polls.utils'

const buildCsvFromContacts = (people: PersonOutput[]) => {
  const headers: (keyof PersonOutput)[] = [
    'id',
    'firstName',
    'lastName',
    'cellPhone',
  ]
  const lines = [headers.join(',')]
  for (const person of people) {
    const row = headers.map((key) => csvEscape(person?.[key] ?? ''))
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

// Samples a poll's recipients, records who it is sent to, and posts the CSV
// to Slack for Tevyn to text. The pollCreation and pollExpansion workers
// (src/jobs/jobs.registry.ts) call this. A poll, office, organization or user
// that is gone completes the job quietly: a retry would find it gone too.
@Injectable()
export class PollExecutionService extends createPrismaBase(MODELS.Poll) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly s3Service: S3Service,
    private readonly slackService: SlackService,
  ) {
    super()
  }

  runCreation(job: JobRun<{ pollId: string }>) {
    return this.execute({
      job,
      sampleParams: (poll) => ({ size: poll.targetAudienceSize }),
      isExpansion: false,
    })
  }

  runExpansion(job: JobRun<{ pollId: string }>) {
    return this.execute({
      job,
      sampleParams: async (poll) => {
        const alreadySent = await this.client.pollIndividualMessage.findMany({
          where: {
            pollId: poll.id,
            sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          },
          select: { personId: true },
        })

        return {
          size: poll.targetAudienceSize - alreadySent.length,
          excludeIds: alreadySent.map((p) => p.personId),
        }
      },
      isExpansion: true,
    })
  }

  private async execute(params: {
    job: JobRun<{ pollId: string }>
    sampleParams: (poll: Poll) => Promise<SampleContacts> | SampleContacts
    isExpansion: boolean
  }): Promise<void> {
    const { pollId } = params.job.data
    const data = await this.getPollAndOrganization(pollId)
    if (!data) {
      this.logger.info(`${pollId} Poll not found, ignoring event`)
      return
    }
    const { poll, office, organization } = data

    const user = await this.client.user.findUnique({
      where: { id: office.userId },
    })
    this.logger.info(`${pollId} Fetched sample and user`)

    if (!user) {
      this.logger.info(`${pollId} User not found, ignoring event`)
      return
    }

    const bucket = process.env.TEVYN_POLL_CSVS_BUCKET
    if (!bucket) {
      throw new Error(
        `${pollId} TEVYN_POLL_CSVS_BUCKET environment variable is required`,
      )
    }
    // It's important that this filename be deterministic based on the particular poll "run".
    // That way, in the event of a failure and retry, we can safely re-use a previously generated CSV.
    // We use the estimated completion date here because it gets set when the poll expanded, and then
    // does not change.
    const fileName = `${poll.id}-${poll.estimatedCompletionDate.toISOString()}.csv`
    const key = this.s3Service.buildKey(undefined, fileName)

    // 1. Get or create the CSV file of a random sample of contacts.
    // We do get-or-create here so that the logic remains retry-safe in the event of a failure.
    let csv = await this.s3Service.getFile(bucket, key)

    if (!csv) {
      this.logger.info(`${pollId} No existing CSV found, generating new one`)
      const sampleParams = await params.sampleParams(poll)
      this.logger.info(
        { sampleParams },
        `${poll.id} Sampling contacts with params: `,
      )
      const sample = await this.contactsService.sampleContacts(
        sampleParams,
        organization,
      )
      if (sample.length === 0) {
        throw new Error(`No contacts returned in sample for poll ${poll.id}`)
      }
      this.logger.info(
        `${pollId} Generated sample of ${sample.length} contacts`,
      )
      csv = buildCsvFromContacts(sample)
      await this.s3Service.uploadFile(bucket, csv, key, {
        contentType: 'text/csv',
      })
    }

    const people = await parseCsv<{ id: string; cellPhone: string }>(csv)

    // 2. Create individual poll messages
    // IDs are deterministic (`pollId-personId`) so re-processing the same CSV
    // is safe: skipDuplicates silently ignores rows that already exist.
    const now = new Date()
    const messages: Prisma.PollIndividualMessageCreateManyInput[] = people.map(
      (person) => ({
        id: `${poll.id}-${person.id}`,
        pollId: poll.id,
        personId: person.id!,
        sentAt: now,
        personCellPhone: normalizePhoneNumber(person.cellPhone),
        electedOfficeId: poll.electedOfficeId,
      }),
    )
    await this.client.pollIndividualMessage.createMany({
      data: messages,
      skipDuplicates: true,
    })

    this.logger.info(`${pollId} Created individual poll messages`)

    // Everything above is safe to repeat; the Slack post is not. pg-boss
    // aborts the signal on shutdown and starts the retry elsewhere, so stop
    // here rather than race that retry into a second post.
    if (params.job.signal.aborted) {
      throw new Error(`${pollId} stopped before the Slack post`)
    }

    // 3. Send CSV file to Slack for Tevyn
    if (!this.slackService.isConfigured) {
      this.logger.warn(
        `${pollId} Slack not configured, skipping Tevyn poll message`,
      )
    } else {
      await sendTevynAPIPollMessage(this.slackService.client, {
        message: poll.messageContent,
        pollId: poll.id,
        scheduledDate: isBefore(poll.scheduledDate, new Date())
          ? 'Now'
          : formatInTimeZone(poll.scheduledDate, 'America/New_York', 'PP p') +
            ' ET',
        csv: {
          fileContent: Buffer.from(csv),
          filename: `${user.email}-${format(poll.scheduledDate, 'yyyy-MM-dd')}.csv`,
        },
        imageUrl: poll.imageUrl || undefined,
        userInfo: {
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          email: user.email,
          phone: user.phone || undefined,
        },
        isExpansion: params.isExpansion,
      })
      this.logger.info(`${pollId} Slack message sent`)
    }
  }

  private async getPollAndOrganization(pollId: string) {
    const poll = await this.model.findUnique({ where: { id: pollId } })
    if (!poll) {
      this.logger.info('Poll not found, ignoring event')
      return
    }

    if (!poll.electedOfficeId) {
      this.logger.info('Poll has no elected office, ignoring event')
      return
    }

    const office = await this.client.electedOffice.findUnique({
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
}
