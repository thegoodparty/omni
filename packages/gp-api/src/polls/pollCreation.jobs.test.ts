import { v7 as uuidv7 } from 'uuid'
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest'
import { StatsResponse } from '@/contacts/contacts.types'
import { PersonOutput } from '@/contacts/schemas/person.schema'
import { ContactsService } from '@/contacts/services/contacts.service'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { PollIndividualMessageSender } from '../generated/prisma'

// The pollCreation job, driven by the route that creates a poll. People-API,
// S3 and Slack are stubbed at their service seams; the poll, the job and the
// rows it writes are real.
const service = useTestService({ jobs: true })

const SAMPLE: PersonOutput[] = [
  {
    id: 'person-1',
    firstName: 'Alice',
    lastName: 'Smith',
    cellPhone: '(307) 555-0101',
  },
  {
    id: 'person-2',
    firstName: 'Bob',
    lastName: 'Jones',
    cellPhone: '3075550102',
  },
] as PersonOutput[]

let eoOrgSlug: string
let electedOfficeId: string
let sampleContacts: MockInstance<ContactsService['sampleContacts']>
let getFile: MockInstance<S3Service['getFile']>
let uploadFile: MockInstance<S3Service['uploadFile']>
let filesUploadV2: MockInstance<SlackService['client']['filesUploadV2']>

const createPoll = () =>
  service.client.post(
    '/v1/polls/initial-poll',
    { message: 'What matters most to you?', swornInDate: '2025-01-01' },
    { headers: { 'x-organization-slug': eoOrgSlug } },
  )

beforeEach(async () => {
  electedOfficeId = uuidv7()
  eoOrgSlug = `eo-${electedOfficeId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: {
      id: electedOfficeId,
      userId: service.user.id,
      organizationSlug: eoOrgSlug,
    },
  })

  const contacts = service.app.get(ContactsService)
  vi.spyOn(contacts, 'getDistrictStats').mockResolvedValue({
    totalConstituentsWithCellPhone: 1000,
  } as StatsResponse)
  sampleContacts = vi
    .spyOn(contacts, 'sampleContacts')
    .mockResolvedValue(SAMPLE)
  const s3 = service.app.get(S3Service)
  getFile = vi.spyOn(s3, 'getFile').mockResolvedValue(undefined)
  uploadFile = vi.spyOn(s3, 'uploadFile').mockResolvedValue('uploaded')
  filesUploadV2 = vi
    .spyOn(service.app.get(SlackService).client, 'filesUploadV2')
    .mockResolvedValue({ ok: true, files: [] })
})

describe('the pollCreation job', () => {
  it('samples the new poll, records who it texts and posts the CSV to Slack', async () => {
    const res = await createPoll()
    expect(res.status).toBe(201)
    const pollId: string = res.data.id

    await service.jobs.settle()

    expect(sampleContacts).toHaveBeenCalledExactlyOnceWith(
      { size: 500 },
      expect.objectContaining({ slug: eoOrgSlug }),
    )
    expect(uploadFile).toHaveBeenCalledExactlyOnceWith(
      'tevyn-poll-csvs-develop',
      expect.stringContaining('person-1,Alice,Smith'),
      expect.stringContaining(pollId),
      { contentType: 'text/csv' },
    )
    const messages = await service.prisma.pollIndividualMessage.findMany({
      where: { pollId },
      orderBy: { personId: 'asc' },
    })
    expect(messages).toMatchObject([
      {
        id: `${pollId}-person-1`,
        personId: 'person-1',
        personCellPhone: '+13075550101',
        sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
        electedOfficeId,
      },
      {
        id: `${pollId}-person-2`,
        personId: 'person-2',
        personCellPhone: '+13075550102',
        sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
        electedOfficeId,
      },
    ])
    expect(filesUploadV2).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(filesUploadV2.mock.calls[0])).toContain(
      `*Poll ID:* \`${pollId}\``,
    )
  })

  it('reuses the CSV an earlier attempt left in S3 instead of sampling again', async () => {
    getFile.mockResolvedValue(
      'id,firstName,lastName,cellPhone\nperson-9,Cy,Lee,3075550109',
    )

    const res = await createPoll()
    await service.jobs.settle()

    expect(sampleContacts).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
    const messages = await service.prisma.pollIndividualMessage.findMany({
      where: { pollId: res.data.id },
    })
    expect(messages.map((m) => m.personId)).toEqual(['person-9'])
    expect(filesUploadV2).toHaveBeenCalledTimes(1)
  })

  it('dead-letters a poll whose sample comes back empty, after its retries', async () => {
    sampleContacts.mockResolvedValue([])

    const res = await createPoll()
    const pollId: string = res.data.id
    const { deadLetters } = await service.jobs.settle({
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([
      {
        name: 'pollCreation',
        data: { pollId },
        error: `No contacts returned in sample for poll ${pollId}`,
      },
    ])
    expect(sampleContacts).toHaveBeenCalledTimes(3)
    expect(filesUploadV2).not.toHaveBeenCalled()
  })
})
