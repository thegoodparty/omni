import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConstituentActivityType } from '@/contactEngagement/contactEngagement.types'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

const service = useTestService()

const ROUTE = '/v1/test-fixtures/polls/results'
const TEST_EMAIL = 'qa-00000000-0000-0000-0000-000000000000@goodparty.org'
const PERSON_ID = 'person-poll-respondent'
const BODY = {
  personId: PERSON_ID,
  issueTitle: 'Traffic Congestion',
  issueSummary: 'Traffic congestion is a major problem in the city.',
}

describe('POST /v1/test-fixtures/polls/results', () => {
  let eoOrgSlug: string

  beforeEach(async () => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: TEST_EMAIL },
    })

    const suffix = Date.now()
    const campaignOrgSlug = `campaign-${suffix}`
    eoOrgSlug = `eo-${suffix}`
    await service.prisma.organization.createMany({
      data: [
        { slug: campaignOrgSlug, ownerId: service.user.id },
        { slug: eoOrgSlug, ownerId: service.user.id },
      ],
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `test-campaign-${suffix}`,
        organizationSlug: campaignOrgSlug,
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        campaignId: campaign.id,
        organizationSlug: eoOrgSlug,
      },
    })
  })

  it('seeds a completed poll the person overlay reads as an issue and a sent and responded poll activity', async () => {
    const headers = { 'x-organization-slug': eoOrgSlug }

    const seeded = await service.client.post(ROUTE, BODY, { headers })

    expect(seeded.status).toBe(201)
    expect(seeded.data).toEqual({
      pollId: expect.any(String),
      pollName: 'Top Community Issues',
    })
    const { pollId } = seeded.data

    const poll = await service.client.get(`/v1/polls/${pollId}`, { headers })
    expect(poll.data).toMatchObject({
      id: pollId,
      status: 'completed',
      name: 'Top Community Issues',
    })

    const issues = await service.client.get(
      `/v1/contact-engagement/${PERSON_ID}/issues`,
      { headers },
    )
    expect(issues.data.results).toEqual([
      expect.objectContaining({
        issueTitle: BODY.issueTitle,
        issueSummary: BODY.issueSummary,
        pollTitle: 'Top Community Issues',
        pollId,
      }),
    ])

    const activities = await service.client.get(
      `/v1/contact-engagement/${PERSON_ID}/activities`,
      { headers },
    )
    expect(activities.data.results).toEqual([
      expect.objectContaining({
        type: ConstituentActivityType.POLL_INTERACTIONS,
        data: {
          pollId,
          pollTitle: 'Top Community Issues',
          events: [
            expect.objectContaining({ type: 'SENT' }),
            expect.objectContaining({ type: 'RESPONDED' }),
          ],
        },
      }),
    ])
  })

  it('404s for an office the caller does not hold', async () => {
    const res = await service.client.post(ROUTE, BODY, {
      headers: { 'x-organization-slug': 'eo-someone-else' },
    })

    expect(res.status).toBe(404)
    expect(await service.prisma.poll.count()).toBe(0)
  })

  it('refuses a caller that is not a test user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'candidate@example.com' },
    })

    const res = await service.client.post(ROUTE, BODY, {
      headers: { 'x-organization-slug': eoOrgSlug },
    })

    expect(res.status).toBe(403)
    expect(await service.prisma.poll.count()).toBe(0)
  })

  it('404s off a non-prod deploy', async () => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = false

    const res = await service.client.post(ROUTE, BODY, {
      headers: { 'x-organization-slug': eoOrgSlug },
    })

    expect(res.status).toBe(404)
    expect(await service.prisma.poll.count()).toBe(0)
  })
})
