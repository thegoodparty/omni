import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { WebsiteStatus } from '../../generated/prisma'
import {
  MAX_CONTACT_FORM_MESSAGE_LENGTH,
  MAX_CONTACT_FORM_NAME_LENGTH,
} from '../schemas/ContactForm.schema'

const service = useTestService()

const VANITY_PATH = 'jordan-for-council'
const ROUTE = `/v1/websites/${VANITY_PATH}/contact-form`

// `trustProxy` is on, so an X-Forwarded-For header is what the rate-limit
// guard keys on. Each test uses its own address so one test's spend cannot
// exhaust another's budget.
const from = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } })

const body = {
  name: 'Alex Rivera',
  email: 'alex@example.com',
  message: 'I would like to volunteer.',
  smsConsent: false,
}

const countContacts = () => service.prisma.websiteContact.count()

describe('POST /v1/websites/:vanityPath/contact-form', () => {
  beforeEach(async () => {
    await service.prisma.organization.create({
      data: { slug: 'org-contact-form', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        id: 1,
        organizationSlug: 'org-contact-form',
        userId: service.user.id,
        slug: 'jordan-smith',
        isActive: true,
      },
    })
    await service.prisma.website.create({
      data: {
        campaignId: 1,
        vanityPath: VANITY_PATH,
        status: WebsiteStatus.published,
        content: {},
      },
    })
  })

  it('records a submission within the limit', async () => {
    const result = await service.client.post(ROUTE, body, from('10.1.0.1'))

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(await countContacts()).toBe(1)
  })

  it('rejects a name past the cap without writing', async () => {
    const result = await service.client.post(
      ROUTE,
      { ...body, name: 'a'.repeat(MAX_CONTACT_FORM_NAME_LENGTH + 1) },
      from('10.1.0.2'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await countContacts()).toBe(0)
  })

  it('rejects a message past the cap without writing', async () => {
    const result = await service.client.post(
      ROUTE,
      { ...body, message: 'a'.repeat(MAX_CONTACT_FORM_MESSAGE_LENGTH + 1) },
      from('10.1.0.3'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await countContacts()).toBe(0)
  })

  it('accepts a message exactly at the cap', async () => {
    const result = await service.client.post(
      ROUTE,
      { ...body, message: 'a'.repeat(MAX_CONTACT_FORM_MESSAGE_LENGTH) },
      from('10.1.0.4'),
    )

    expect(result.status).toBe(HttpStatus.CREATED)
  })

  it('refuses the sixth submission from one address and writes nothing', async () => {
    for (let i = 0; i < 5; i++) {
      const allowed = await service.client.post(ROUTE, body, from('10.1.0.5'))
      expect(allowed.status).toBe(HttpStatus.CREATED)
    }

    const refused = await service.client.post(ROUTE, body, from('10.1.0.5'))

    expect(refused.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(await countContacts()).toBe(5)
  })
})
