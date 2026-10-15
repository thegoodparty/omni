import { useTestService } from '@/test-service'
import { describe, expect, it, vi } from 'vitest'
import { CampaignTaskType } from '../../../generated/prisma'
import { CampaignTasksService } from '../../tasks/services/campaignTasks.service'
import { SlackService } from '@/vendors/slack/services/slack.service'

const service = useTestService()

const DAY_MS = 24 * 60 * 60 * 1000
const utcToday = () => {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}
const daysFromToday = (days: number) => new Date(utcToday() + days * DAY_MS)

// Texting closes 19 days before the general election.
const CLOSED_ELECTION = daysFromToday(10).toISOString().slice(0, 10)
const OPEN_ELECTION = '2099-11-03'

const makeProCampaign = async (electionDate: string) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const user = await service.prisma.user.create({
    data: {
      email: `sms-cutoff-slack-${unique}@example.com`,
      firstName: 'Jordan',
      lastName: 'Nguyen',
    },
  })
  const org = await service.prisma.organization.create({
    data: { slug: `sms-cutoff-slack-${unique}`, ownerId: user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: user.id,
      slug: `sms-cutoff-slack-${unique}`,
      details: { electionDate },
      organizationSlug: org.slug,
      isPro: true,
    },
  })
}

const slackTexts = () => {
  const slack = service.app.get(SlackService)
  const spy = vi.spyOn(slack, 'message').mockResolvedValue('ok' as never)
  return () =>
    spy.mock.calls.map(
      ([message]) =>
        (message.blocks?.[0] as { text: { text: string } }).text.text,
    )
}

const seedTrackerRows = async (campaignId: number) => {
  await service.prisma.campaignStrategy.create({ data: { campaignId } })
  const row = (
    title: string,
    flowType: CampaignTaskType,
    date: Date,
    isDefaultTask: boolean,
  ) =>
    service.prisma.campaignTrackerTask.create({
      data: {
        campaignId,
        title,
        description: '',
        flowType,
        week: 1,
        date,
        phase: 'active',
        isDefaultTask,
      },
    })
  await row(
    'Knock doors',
    CampaignTaskType.doorKnocking,
    daysFromToday(1),
    false,
  )
  await row('Early Voting Text', CampaignTaskType.text, daysFromToday(1), true)
  await row(
    'Election Day Reminder Robocall',
    CampaignTaskType.robocall,
    daysFromToday(1),
    true,
  )
}

describe('CAS Slack posts once texting closes', () => {
  it('leaves text sends out of the tracker week and schedule posts', async () => {
    const campaign = await makeProCampaign(CLOSED_ELECTION)
    await seedTrackerRows(campaign.id)
    const texts = slackTexts()

    await service.app
      .get(CampaignTasksService)
      .notifySlackOnProUpgrade(campaign.id)

    const [week, schedule] = texts()
    expect(week).toContain('Knock doors')
    expect(week).toContain('ROBOCALL: Election Day Reminder Robocall')
    expect(week).not.toContain('TEXT:')
    expect(schedule).toContain('AI Campaign Plan Created')
    expect(schedule).toContain('*Outreach Tasks (1):*')
    expect(schedule).not.toContain('TEXT:')
  })

  it('keeps text sends in the posts while texting is open', async () => {
    const campaign = await makeProCampaign(OPEN_ELECTION)
    await seedTrackerRows(campaign.id)
    const texts = slackTexts()

    await service.app
      .get(CampaignTasksService)
      .notifySlackOnProUpgrade(campaign.id)

    const [week, schedule] = texts()
    expect(week).toContain('TEXT: Early Voting Text')
    expect(schedule).toContain('*Outreach Tasks (2):*')
    expect(schedule).toContain('TEXT: Early Voting Text')
  })

  it('leaves text tasks out of the legacy plan post', async () => {
    const campaign = await makeProCampaign(CLOSED_ELECTION)
    for (const [title, flowType] of [
      ['Introduction Text', CampaignTaskType.text],
      ['Introduction Robocall', CampaignTaskType.robocall],
    ] as const) {
      await service.prisma.campaignTask.create({
        data: {
          campaignId: campaign.id,
          title,
          description: '',
          flowType,
          week: 4,
          date: daysFromToday(2),
          isDefaultTask: true,
        },
      })
    }
    const texts = slackTexts()

    await service.app
      .get(CampaignTasksService)
      .notifySlackOnProUpgrade(campaign.id)

    const [plan] = texts()
    expect(plan).toContain('*Outreach Tasks (1):*')
    expect(plan).toContain('ROBOCALL: Introduction Robocall')
    expect(plan).not.toContain('TEXT:')
  })
})
