import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_CONTENT_EXAMPLES } from '@goodparty_org/contracts'
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
  it('renders each layout preset from blocks with its own treatment', async () => {
    const [shortCta, longUpdate, letter] = await Promise.all(
      (['short_cta', 'long_update', 'personal_letter'] as const).map(
        async (layout) => {
          const res = await previewWin({
            content: EMAIL_CONTENT_EXAMPLES[layout].win,
          })
          expect(res.status).toBe(HttpStatus.CREATED)
          return res.data.html as string
        },
      ),
    )
    expect(shortCta).toContain('font-size:36px')
    expect(shortCta).toContain('class="em-accent"')
    expect(longUpdate).toContain('class="em-header"')
    expect(longUpdate).toContain('class="em-subheading"')
    expect(letter).not.toContain('class="em-header"')
    expect(letter).toContain('class="em-cta-link"')
    expect(letter).toContain('Dear Alex,')
  })

  it('shows the sender and today on the long update masthead', async () => {
    const { data } = await previewServe({
      content: EMAIL_CONTENT_EXAMPLES.long_update.serve,
    })
    expect(data.html).toMatch(/ · [A-Z][a-z]+ \d{1,2}, \d{4}</)
  })

  it('renders the old fields as blocks', async () => {
    const res = await previewWin(
      previewBody({ body: 'Hi {{first_name}},\n\nCome say hello.' }),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.html).toContain('class="em-header"')
    expect(res.data.html).toContain('>Join us</h1>')
  })

  it('rejects a block the layout does not allow', async () => {
    const res = await previewWin({
      content: {
        ...EMAIL_CONTENT_EXAMPLES.personal_letter.win,
        blocks: [{ type: 'divider' }, { type: 'paragraph', text: 'Hi' }],
      },
    })
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
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

  it('renders a half-typed draft', async () => {
    const res = await previewWin({
      content: {
        layout: 'short_cta',
        theme: 'bold_red',
        subject: '',
        blocks: [
          { type: 'image', url: '', alt: '' },
          { type: 'heading', text: 'Half', level: 1 },
          { type: 'paragraph', text: '' },
          { type: 'button', label: 'RSVP', url: '' },
        ],
      },
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.html).toContain('>Half</h1>')
    expect(res.data.html).toContain('RSVP')
  })

  it('accepts the sample images the examples use', async () => {
    const res = await previewWin({
      content: EMAIL_CONTENT_EXAMPLES.short_cta.win,
    })
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.html).toContain(
      'https://app.goodparty.org/images/email-samples/street.jpg',
    )
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

  it('keeps typed braces literal and fills only the merge tags', async () => {
    const { data } = await previewWin(
      previewBody({ body: 'Hi {{first_name}} and {x}' }),
    )
    expect(data.html).toContain('Hi Alex and &#123;x&#125;')
  })

  it('rejects merge tags other than first and last name', async () => {
    const res = await previewWin(
      previewBody({ body: 'Hi {{first_name}} and {{unsubscribe_url}}' }),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
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

  it('rejects an image presigned for another organization', async () => {
    const imageUrl = `https://${ASSET_DOMAIN}/email-images/${winSlug}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`
    const res = await previewServe(previewBody({ imageUrl }))
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('fills the recipient variables', async () => {
    const { data } = await previewServe(previewBody())
    expect(data.html).toContain('Hi Alex Rivera,')
  })
})
