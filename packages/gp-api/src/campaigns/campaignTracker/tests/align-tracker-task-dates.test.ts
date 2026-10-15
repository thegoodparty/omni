import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  CampaignTaskType,
  CampaignTrackerTask,
  OfficeLevel,
} from '../../../generated/prisma'

const service = useTestService()

const BASE_PATH = '/v1/campaigns/tracker-tasks'
const ORG_SLUG = 'campaign-org-align-tracker-dates-test'
const orgHeaders = { headers: { 'x-organization-slug': ORG_SLUG } }

// A plan started Jan 5 for a November election, with rows dated by the old
// signup-relative rules: going-public work two weeks after signup.
const setup = async (
  rows: [title: string, date: string, completed?: boolean][] = [
    ['Get your EIN', '2099-01-05T00:00:00.000Z'],
    ['Set up your social media', '2099-01-19T00:00:00.000Z'],
    ['Pick your announcement date', '2099-01-19T00:00:00.000Z', true],
  ],
) => {
  const org = await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: 'align-tracker-dates-campaign',
      details: { electionDate: '2099-11-03' },
      organizationSlug: org.slug,
    },
  })
  const row = (title: string, date: string, completed = false) =>
    service.prisma.campaignTrackerTask.create({
      data: {
        campaignId: campaign.id,
        title,
        description: '',
        week: 0,
        date: new Date(date),
        phase: 'launch',
        isDefaultTask: true,
        completed,
      },
    })
  const created = []
  for (const [title, date, completed] of rows) {
    created.push(await row(title, date, completed))
  }
  return created
}

describe('Campaign tracker tasks - dates on the timeline', () => {
  it('moves open rows onto the timeline when the tracker is read', async () => {
    const [start, open, done] = await setup()
    if (!start || !open || !done) throw new Error('rows not created')

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.OK)
    const dateOf = (id: string) =>
      String(result.data.find((task) => task.id === id)?.date).slice(0, 7)
    // Going public lands in Launch's last two weeks, ten weeks before the
    // election, not two weeks after signup.
    expect(dateOf(open.id)).toBe('2099-08')
    // The anchor and finished work stay where they are.
    expect(dateOf(start.id)).toBe('2099-01')
    expect(dateOf(done.id)).toBe('2099-01')
  })

  it('compresses a late joiner’s past-due sends into the time ahead', async () => {
    // Joined Oct 7 for a Nov 3 election: the intro text was due Sep 8.
    const [, intro] = await setup([
      ['Get your EIN', '2099-10-07T00:00:00.000Z'],
      ['Introduction Text', '2099-09-08T00:00:00.000Z'],
    ])
    if (!intro) throw new Error('row not created')

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    const date = String(
      result.data.find((task) => task.id === intro.id)?.date,
    ).slice(0, 7)
    expect(date).toBe('2099-10')
  })
})

const DAY_MS = 24 * 60 * 60 * 1000
const utcToday = () => {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}
const daysFromToday = (days: number) => new Date(utcToday() + days * DAY_MS)

// Texting closes 19 days before the general election, so a race 10 days out
// is closed and one in 2099 is open.
const setupOutreach = async (
  electionDate: Date,
  rows: [
    title: string,
    flowType: CampaignTaskType | null,
    date: Date,
    completed?: boolean,
  ][],
  filedAndPaid = false,
) => {
  const org = await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: 'align-tracker-dates-campaign',
      details: { electionDate: electionDate.toISOString().slice(0, 10) },
      organizationSlug: org.slug,
    },
  })
  if (filedAndPaid) {
    await service.prisma.tcrCompliance.create({
      data: {
        campaignId: campaign.id,
        ein: '12-3456789',
        postalAddress: '123 Main St',
        committeeName: 'Committee',
        websiteDomain: 'example.org',
        filingUrl: 'https://sos.example.gov/filing',
        phone: '555-000-1234',
        email: 'candidate@example.com',
        officeLevel: OfficeLevel.local,
        kickoffSentAt: new Date(),
      },
    })
  }
  const created = []
  for (const [title, flowType, date, completed = false] of rows) {
    created.push(
      await service.prisma.campaignTrackerTask.create({
        data: {
          campaignId: campaign.id,
          title,
          description: '',
          flowType,
          week: 0,
          date,
          phase: 'active',
          isDefaultTask: true,
          completed,
        },
      }),
    )
  }
  return created
}

const outreachOf = (tasks: CampaignTrackerTask[]) =>
  tasks
    .filter((task) => task.flowType === 'text' || task.flowType === 'robocall')
    .map((task) => ({
      title: task.title,
      flowType: task.flowType,
      date: String(task.date).slice(0, 10),
      completed: task.completed,
    }))
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    )

describe('Campaign tracker tasks - text sends once texting closes', () => {
  // An early joiner whose race is now 10 days out.
  const election = daysFromToday(10)
  const sendDate = (daysBefore: number) =>
    new Date(election.getTime() - daysBefore * DAY_MS)
  const day = (date: Date) => date.toISOString().slice(0, 10)
  const earlyJoinerRows = (): [
    string,
    CampaignTaskType | null,
    Date,
    boolean?,
  ][] => [
    ['Get your EIN', null, sendDate(80)],
    ['Introduction Text', CampaignTaskType.text, sendDate(56)],
    ['Introduction Robocall', CampaignTaskType.robocall, sendDate(49)],
    ['Persuasion Text', CampaignTaskType.text, sendDate(35), true],
    ['Early Voting Text', CampaignTaskType.text, sendDate(14)],
    ['Election Day Reminder Robocall', CampaignTaskType.robocall, sendDate(1)],
    ['Election Day Reminder Text', CampaignTaskType.text, sendDate(0)],
  ]

  it('swaps open text sends for robocalls on their dates and keeps completed ones', async () => {
    await setupOutreach(election, earlyJoinerRows())

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(outreachOf(result.data)).toEqual([
      {
        title: 'Early Introduction Robocall',
        flowType: 'robocall',
        date: day(sendDate(56)),
        completed: false,
      },
      {
        title: 'Introduction Robocall',
        flowType: 'robocall',
        date: day(sendDate(49)),
        completed: false,
      },
      {
        title: 'Persuasion Text',
        flowType: 'text',
        date: day(sendDate(35)),
        completed: true,
      },
      {
        title: 'Early Voting Robocall',
        flowType: 'robocall',
        date: day(sendDate(14)),
        completed: false,
      },
      {
        title: 'Election Day Reminder Robocall',
        flowType: 'robocall',
        date: day(sendDate(1)),
        completed: false,
      },
    ])

    // The swapped rows stay on their text send's date on the next read.
    const again = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )
    expect(outreachOf(again.data)).toEqual(outreachOf(result.data))
  })

  it('drops a text send that lands on a robocall date', async () => {
    // A late joiner three days out: the intro sends both crowd onto the
    // start day, so the text there goes rather than doubling the robocall.
    const lateElection = daysFromToday(3)
    await setupOutreach(lateElection, [
      ['Get your EIN', null, daysFromToday(0)],
      ['Introduction Text', CampaignTaskType.text, daysFromToday(-50)],
      ['Introduction Robocall', CampaignTaskType.robocall, daysFromToday(-46)],
    ])

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    expect(outreachOf(result.data)).toEqual([
      {
        title: 'Introduction Robocall',
        flowType: 'robocall',
        date: day(daysFromToday(0)),
        completed: false,
      },
    ])
  })

  it('swaps a put-off text send on the date the candidate picked', async () => {
    const [, putOff] = await setupOutreach(election, [
      ['Get your EIN', null, sendDate(80)],
      ['Early Voting Text', CampaignTaskType.text, sendDate(14)],
    ])
    const pickedDate = daysFromToday(4)
    await service.prisma.campaignTrackerTask.update({
      where: { id: putOff.id },
      data: { skipReason: 'later', date: pickedDate },
    })

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    expect(outreachOf(result.data)).toEqual([
      {
        title: 'Early Voting Robocall',
        flowType: 'robocall',
        date: day(pickedDate),
        completed: false,
      },
    ])
    const stored = await service.prisma.campaignTrackerTask.findUniqueOrThrow({
      where: { id: putOff.id },
    })
    expect(stored.skipReason).toBe('later')
  })

  it('leaves text sends alone while texting is open', async () => {
    await setupOutreach(new Date('2099-11-03T00:00:00.000Z'), [
      ['Get your EIN', null, new Date('2099-01-05T00:00:00.000Z')],
      [
        'Early Voting Text',
        CampaignTaskType.text,
        new Date('2099-10-20T00:00:00.000Z'),
      ],
    ])

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    expect(outreachOf(result.data)).toEqual([
      {
        title: 'Early Voting Text',
        flowType: 'text',
        date: '2099-10-20',
        completed: false,
      },
    ])
  })

  it('leaves text sends alone for a candidate who filed and paid before the cutoff', async () => {
    await setupOutreach(election, earlyJoinerRows(), true)

    const result = await service.client.get<CampaignTrackerTask[]>(
      BASE_PATH,
      orgHeaders,
    )

    expect(
      outreachOf(result.data).filter((task) => task.flowType === 'text'),
    ).toHaveLength(4)
  })
})
