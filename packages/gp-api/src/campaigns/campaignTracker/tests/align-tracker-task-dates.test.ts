import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { CampaignTrackerTask } from '../../../generated/prisma'

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
