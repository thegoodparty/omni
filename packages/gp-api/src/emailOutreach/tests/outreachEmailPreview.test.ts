import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeLevel } from '../../generated/prisma'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { useTestService } from '@/test-service'
import { SesService } from '../services/ses.service'

const service = useTestService()

let winSlug: string
let officeSlug: string
let campaignId: number

const sendEmail = vi.fn()

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const previewBody = (overrides: object = {}) => ({
  layout: 'newsletter',
  theme: 'classic_blue',
  subject: 'Town hall on Thursday',
  headline: 'Join us',
  body: 'Hi {{first_name}} {{last_name}},\n\nCome say hello.',
  buttonLabel: 'RSVP',
  buttonUrl: 'https://example.com/rsvp',
  ...overrides,
})

const preview = (path: string, slug: string, body: object) =>
  service.client.post(path, body, {
    headers: { 'x-organization-slug': slug },
    validateStatus: () => true,
  })
const previewWin = (body: object) =>
  preview('/v1/outreach/email/preview', winSlug, body)
const previewServe = (body: object) =>
  preview('/v1/outreach/serve/email/preview', officeSlug, body)

beforeEach(async () => {
  sendEmail.mockReset().mockResolvedValue('message-id')
  vi.spyOn(service.app.get(SesService), 'sendEmail').mockImplementation(
    sendEmail,
  )
  const suffix = unique()
  winSlug = `campaign-${suffix}`
  officeSlug = `eo-${suffix}`
  campaignId = Math.floor(Math.random() * 1_000_000) + 1000
  await service.prisma.organization.create({
    data: { slug: winSlug, ownerId: service.user.id },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: winSlug,
      userId: service.user.id,
      slug: `jane-${suffix}`,
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
  await service.prisma.tcrCompliance.create({
    data: {
      campaignId,
      committeeName: 'Jane for Texas',
      ein: '12-3456789',
      postalAddress: '123 Main St',
      websiteDomain: 'example.com',
      filingUrl: 'https://example.com/filing',
      phone: '5551234567',
      email: 'test@example.com',
      officeLevel: OfficeLevel.state,
    },
  })
  await service.prisma.organization.create({
    data: { slug: officeSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: {
      userId: service.user.id,
      organizationSlug: officeSlug,
      campaignId,
    },
  })
})

describe('POST /v1/outreach/email/preview', () => {
  it('returns materially different HTML for each layout', async () => {
    const layouts = ['newsletter', 'reminder', 'call_to_action']
    const htmls = await Promise.all(
      layouts.map(async (layout) => {
        const res = await previewWin(previewBody({ layout }))
        expect(res.status).toBe(HttpStatus.CREATED)
        return res.data.html as string
      }),
    )
    const [newsletter, reminder, callToAction] = htmls
    expect(new Set(htmls).size).toBe(3)
    expect(reminder).toContain('class="em-accent"')
    expect(newsletter).not.toContain('class="em-accent"')
    expect(callToAction).not.toContain('class="em-accent"')
    expect(callToAction).toContain('font-size:34px')
    expect(newsletter).not.toContain('font-size:34px')
    expect(reminder).not.toContain('font-size:34px')
  })

  it('fills the recipient variables with sample values', async () => {
    const { data } = await previewWin(previewBody())
    expect(data.html).toContain('Hi Alex Rivera,')
    expect(data.html).not.toContain('{{first_name}}')
    expect(data.html).not.toContain('{{last_name}}')
    expect(data.html).not.toContain('{{unsubscribe_url}}')
    expect(data.html).toContain('href="#"')
  })

  it('shows the committee on the Win footer', async () => {
    const { data } = await previewWin(previewBody())
    expect(data.html).toContain('Paid for by Jane for Texas')
  })

  it('renders a half-typed draft and a call to action with no button', async () => {
    const res = await previewWin(
      previewBody({
        layout: 'call_to_action',
        subject: '',
        body: '',
        headline: undefined,
        buttonLabel: undefined,
        buttonUrl: undefined,
      }),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.html).toContain('Your button')
  })

  it('rejects an image this module did not presign', async () => {
    const res = await previewWin(
      previewBody({ imageUrl: 'https://example.com/a.png' }),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('accepts an image presigned for the organization', async () => {
    const imageUrl = `https://${ASSET_DOMAIN}/email-images/${winSlug}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`
    const res = await previewWin(previewBody({ imageUrl }))
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.html).toContain(imageUrl)
  })

  it('rejects unknown fields and bad layouts', async () => {
    expect((await previewWin(previewBody({ goal: 'extra' }))).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
    expect((await previewWin(previewBody({ layout: 'poster' }))).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
  })

  it('writes nothing and sends nothing', async () => {
    const before = await service.prisma.outreach.count({
      where: { organizationSlug: winSlug },
    })
    await previewWin(previewBody())
    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: winSlug },
      }),
    ).toBe(before)
    expect(
      await service.prisma.outreachEmailSender.count({
        where: { organizationSlug: winSlug },
      }),
    ).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('POST /v1/outreach/serve/email/preview', () => {
  it('has no paid-for-by line, unlike Win', async () => {
    const win = await previewWin(previewBody())
    const serve = await previewServe(previewBody())
    expect(serve.status).toBe(HttpStatus.CREATED)
    expect(win.data.html).toContain('Paid for by')
    expect(serve.data.html).not.toContain('Paid for by')
    expect(serve.data.html).not.toBe(win.data.html)
  })

  it('fills the recipient variables', async () => {
    const { data } = await previewServe(previewBody())
    expect(data.html).toContain('Hi Alex Rivera,')
  })
})
