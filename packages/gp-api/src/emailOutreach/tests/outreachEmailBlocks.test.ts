import { HttpStatus } from '@nestjs/common'
import { addDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMAIL_CONTENT_EXAMPLES,
  type EmailContentDraft,
} from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { useTestService } from '@/test-service'
import { OutreachStatus } from '../../generated/prisma'
import { SesService } from '../services/ses.service'
import {
  createEmailOrgs,
  createSend,
  createSender,
  EmailFixtureOrgs,
  emails,
  stubAudienceFromRecipients,
} from './emailSendFixtures'

const service = useTestService()

const saveCardAndPlan = vi.fn()
const sendEmail = vi.fn()

let orgs: EmailFixtureOrgs

beforeEach(async () => {
  stubAudienceFromRecipients(service.app.get(ContactsService), service.prisma)
  saveCardAndPlan.mockReset().mockResolvedValue({ outcome: 'scheduled' })
  sendEmail.mockReset().mockResolvedValue('message-id')
  vi.spyOn(
    service.app.get(PaymentHoldsService),
    'saveCardAndPlan',
  ).mockImplementation(saveCardAndPlan)
  vi.spyOn(service.app.get(SesService), 'sendEmail').mockImplementation(
    sendEmail,
  )
  orgs = await createEmailOrgs(service.prisma, service.user.id)
})

const winHeaders = () => ({ 'x-organization-slug': orgs.winSlug })
const serveHeaders = () => ({ 'x-organization-slug': orgs.officeSlug })

const post = (path: string, body: object, headers: Record<string, string>) =>
  service.client.post(path, body, { headers, validateStatus: () => true })

const get = (path: string, headers: Record<string, string>) =>
  service.client.get(path, { headers, validateStatus: () => true })

const uploaded = () =>
  `https://${ASSET_DOMAIN}/email-images/${orgs.winSlug}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`

const shortCta = (): EmailContentDraft => ({
  layout: 'short_cta',
  theme: 'bold_red',
  subject: 'Knock doors with me',
  blocks: [
    { type: 'image', url: uploaded(), alt: 'Volunteers on a sidewalk' },
    { type: 'heading', text: 'Help me meet Maple Heights', level: 1 },
    { type: 'paragraph', text: 'Hi {{first_name}}, join me Saturday.' },
    { type: 'button', label: 'Save my spot', url: 'https://example.org/go' },
  ],
})

describe('saving a block draft', () => {
  it('stores the blocks and answers them on save and on GET', async () => {
    const saved = await post(
      '/v1/outreach/email',
      { goal: 'Recruit canvassers', content: shortCta() },
      winHeaders(),
    )
    expect(saved.status).toBe(HttpStatus.CREATED)
    expect(saved.data).toMatchObject({
      status: 'draft',
      layout: 'short_cta',
      theme: 'bold_red',
      subject: 'Knock doors with me',
      headline: null,
      body: '',
      content: shortCta(),
    })

    const read = await get(`/v1/outreach/email/${saved.data.id}`, winHeaders())
    expect(read.data.content).toEqual(shortCta())
  })

  it('keeps an unfinished draft', async () => {
    const res = await post(
      '/v1/outreach/serve/email',
      {
        goal: 'Monthly update',
        content: {
          layout: 'long_update',
          theme: 'classic_blue',
          subject: '',
          blocks: [
            { type: 'heading', text: '', level: 1 },
            { type: 'paragraph', text: '' },
          ],
        },
      },
      serveHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.content.blocks).toHaveLength(2)
  })

  it('rejects a block the layout does not allow, and writes nothing', async () => {
    const res = await post(
      '/v1/outreach/email',
      {
        goal: 'g',
        content: {
          layout: 'personal_letter',
          theme: 'cream_and_forest',
          subject: 'Hi',
          blocks: [
            { type: 'heading', text: 'Not in a letter', level: 1 },
            { type: 'paragraph', text: 'Dear {{first_name}},' },
          ],
        },
      },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(JSON.stringify(res.data)).toContain(
      'The Personal letter layout doesn’t use heading blocks',
    )
    expect(
      await service.prisma.outreach.count({
        where: { organizationSlug: orgs.winSlug },
      }),
    ).toBe(0)
  })

  it('rejects an image block this module did not presign', async () => {
    const content = shortCta()
    content.blocks[0] = {
      type: 'image',
      url: 'https://example.com/a.png',
      alt: 'A photo',
    }
    const res = await post(
      '/v1/outreach/email',
      { goal: 'g', content },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('accepts the sample images the examples use', async () => {
    const res = await post(
      '/v1/outreach/email',
      { goal: 'g', content: EMAIL_CONTENT_EXAMPLES.short_cta.win },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
  })

  it('checks an old-field draft against the block rules when it is saved', async () => {
    const fields = {
      goal: 'g',
      layout: 'newsletter',
      theme: 'classic_blue',
      subject: 'Town hall',
      body: 'Join us.',
    }
    const longParagraph = await post(
      '/v1/outreach/email',
      { ...fields, body: 'a'.repeat(2001) },
      winHeaders(),
    )
    expect(longParagraph.status).toBe(HttpStatus.BAD_REQUEST)
    const unknownTag = await post(
      '/v1/outreach/email',
      { ...fields, body: 'Hi {{city}}' },
      winHeaders(),
    )
    expect(unknownTag.status).toBe(HttpStatus.BAD_REQUEST)
    expect(unknownTag.data.message).toContain('{{first_name}}')
  })

  it('maps an old-field draft to blocks, and clears the blocks when saved with fields again', async () => {
    const fields = {
      goal: 'g',
      layout: 'newsletter',
      theme: 'fresh_green',
      subject: 'Town hall',
      headline: 'Come to the town hall',
      body: 'Hi {{first_name}},\n\nWe meet at 7pm.',
    }
    const created = await post('/v1/outreach/email', fields, winHeaders())
    expect(created.data.content).toEqual({
      layout: 'long_update',
      theme: 'fresh_green',
      subject: 'Town hall',
      blocks: [
        { type: 'heading', text: 'Come to the town hall', level: 1 },
        { type: 'paragraph', text: 'Hi {{first_name}},' },
        { type: 'paragraph', text: 'We meet at 7pm.' },
      ],
    })

    const id = created.data.id
    await post(
      '/v1/outreach/email',
      { id, goal: 'g', content: shortCta() },
      winHeaders(),
    )
    await post('/v1/outreach/email', { id, ...fields }, winHeaders())
    const row = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { outreachId: id },
    })
    expect(row.content).toBeNull()
    expect(row.layout).toBe('newsletter')
  })
})

describe('confirm and test send check the send schema', () => {
  const blockSend = async (content: EmailContentDraft) => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    return createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(3),
      date: addDays(new Date(), 5),
      content,
    })
  }

  const withoutLink = (): EmailContentDraft => {
    const content = shortCta()
    content.blocks[3] = { type: 'button', label: 'Save my spot', url: '' }
    return content
  }

  it('refuses to confirm an unfinished block draft and leaves it a draft', async () => {
    const { outreachId } = await blockSend(withoutLink())
    const res = await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toBe(
      'Finish the email before sending it. Block 4: Links must start with https://',
    )
    expect(saveCardAndPlan).not.toHaveBeenCalled()
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(outreach.status).toBe(OutreachStatus.draft)
  })

  it('confirms a finished block draft', async () => {
    const { outreachId } = await blockSend(shortCta())
    const res = await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.outcome).toBe('scheduled')
  })

  it('test-sends the rendered blocks, and refuses an unfinished draft', async () => {
    const finished = await blockSend(shortCta())
    const sent = await post(
      `/v1/outreach/email/${finished.outreachId}/test`,
      {},
      winHeaders(),
    )
    expect(sent.status).toBe(HttpStatus.CREATED)
    const email = sendEmail.mock.calls[0]?.[0]
    expect(email.subject).toBe('[Test] Knock doors with me')
    expect(email.html).toContain('Help me meet Maple Heights</h1>')
    expect(email.html).toContain('class="em-accent"')

    const unfinished = await blockSend(withoutLink())
    const refused = await post(
      `/v1/outreach/email/${unfinished.outreachId}/test`,
      {},
      winHeaders(),
    )
    expect(refused.status).toBe(HttpStatus.BAD_REQUEST)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})
