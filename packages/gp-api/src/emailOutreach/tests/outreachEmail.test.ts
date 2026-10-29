import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OfficeLevel,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import { EmailService } from '@/email/email.service'
import { useTestService } from '@/test-service'
import { EmailDomainCheckService } from '../services/emailDomainCheck.service'

const service = useTestService()

const sendEmail = vi.fn()
const findUndeliverableDomains = vi.fn()

let winSlug: string
let officeSlug: string
let campaignId: number

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const winHeaders = () => ({ 'x-organization-slug': winSlug })
const serveHeaders = () => ({ 'x-organization-slug': officeSlug })

beforeEach(async () => {
  sendEmail.mockReset().mockResolvedValue(undefined)
  findUndeliverableDomains.mockReset().mockResolvedValue(new Set<string>())
  vi.spyOn(service.app.get(EmailService), 'sendEmail').mockImplementation(
    sendEmail,
  )
  vi.spyOn(
    service.app.get(EmailDomainCheckService),
    'findUndeliverableDomains',
  ).mockImplementation(findUndeliverableDomains)

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
      isPro: true,
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
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

const draftBody = (overrides: object = {}) => ({
  goal: 'Invite neighbors to the town hall',
  layout: 'newsletter',
  theme: 'classic_blue',
  subject: 'Town hall on Thursday',
  body: 'Join us at 7pm.',
  ...overrides,
})

const saveWin = (body: object) =>
  service.client.post('/v1/outreach/email', body, {
    headers: winHeaders(),
    validateStatus: () => true,
  })

const saveServe = (body: object) =>
  service.client.post('/v1/outreach/serve/email', body, {
    headers: serveHeaders(),
    validateStatus: () => true,
  })

const uploadTo = (
  base: 'email' | 'serve/email',
  id: number,
  csv: string | Buffer,
  fields: Record<string, string> = { consentConfirmed: 'true' },
) => {
  const form = new FormData()
  Object.entries(fields).forEach(([key, value]) => form.append(key, value))
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'people.csv')
  return service.client.post(`/v1/outreach/${base}/${id}/recipients`, form, {
    headers: base === 'email' ? winHeaders() : serveHeaders(),
    validateStatus: () => true,
  })
}

describe('POST /v1/outreach/email (Win draft)', () => {
  it('creates a draft with the sender, then updates it in place', async () => {
    const created = await saveWin(draftBody())
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data).toMatchObject({
      status: 'draft',
      layout: 'newsletter',
      subject: 'Town hall on Thursday',
      recipientCount: 0,
      consentConfirmedAt: null,
    })

    const updated = await saveWin(
      draftBody({ id: created.data.id, subject: 'Moved to Friday' }),
    )
    expect(updated.data).toMatchObject({
      id: created.data.id,
      subject: 'Moved to Friday',
    })
    expect(await service.prisma.outreach.count()).toBe(1)

    const fetched = await service.client.get(
      `/v1/outreach/email/${created.data.id}`,
      { headers: winHeaders() },
    )
    expect(fetched.data.subject).toBe('Moved to Friday')

    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: created.data.id },
    })
    expect(row).toMatchObject({
      outreachType: OutreachType.email,
      status: OutreachStatus.draft,
      campaignId,
      organizationSlug: winSlug,
    })
  })

  it('reads the paid-for-by text from the committee, like SMS', async () => {
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
    const res = await saveWin(draftBody())
    expect(res.data.paidForBy).toBe('Jane for Texas')
  })

  it('requires a button on call to action', async () => {
    const res = await saveWin(draftBody({ layout: 'call_to_action' }))
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)

    const ok = await saveWin(
      draftBody({
        layout: 'call_to_action',
        buttonLabel: 'RSVP',
        buttonUrl: 'https://example.com/rsvp',
      }),
    )
    expect(ok.status).toBe(HttpStatus.CREATED)
    expect(ok.data).toMatchObject({ buttonLabel: 'RSVP' })
  })

  it('rejects links that are not https, and unknown layouts or themes', async () => {
    const link = { buttonLabel: 'RSVP', buttonUrl: 'http://example.com' }
    expect((await saveWin(draftBody(link))).status).toBe(HttpStatus.BAD_REQUEST)
    expect((await saveWin(draftBody({ layout: 'poster' }))).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
    expect((await saveWin(draftBody({ theme: 'neon' }))).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
  })

  it('refuses edits once the send has left draft', async () => {
    const created = await saveWin(draftBody())
    await service.prisma.outreach.update({
      where: { id: created.data.id },
      data: { status: OutreachStatus.pending },
    })
    const res = await saveWin(draftBody({ id: created.data.id }))
    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('keeps a saved send time editable after it passes', async () => {
    const date = new Date(Date.now() + 3600_000).toISOString()
    const created = await saveWin(draftBody({ date }))
    await service.prisma.outreach.update({
      where: { id: created.data.id },
      data: { date: new Date(Date.now() - 3600_000) },
    })
    const past = (
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: created.data.id },
      })
    ).date?.toISOString()
    const res = await saveWin(
      draftBody({ id: created.data.id, date: past, subject: 'New' }),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
  })

  it('refuses a send time more than 30 days out', async () => {
    const date = new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString()
    const res = await saveWin(draftBody({ date }))
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('Serve routes', () => {
  it('creates an office-scoped draft with no campaign on the row', async () => {
    const res = await saveServe(draftBody())
    expect(res.status).toBe(HttpStatus.CREATED)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.id },
    })
    expect(row).toMatchObject({
      campaignId: null,
      organizationSlug: officeSlug,
    })
  })

  it("never serves one product's draft to the other", async () => {
    const win = await saveWin(draftBody())
    const serve = await saveServe(draftBody())

    const winFromServe = await service.client.get(
      `/v1/outreach/serve/email/${win.data.id}`,
      { headers: serveHeaders(), validateStatus: () => true },
    )
    const serveFromWin = await service.client.get(
      `/v1/outreach/email/${serve.data.id}`,
      { headers: winHeaders(), validateStatus: () => true },
    )
    expect(winFromServe.status).toBe(HttpStatus.NOT_FOUND)
    expect(serveFromWin.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('sender', () => {
  it('is created on first use from the owner name, forwarding to the login email', async () => {
    const res = await service.client.get('/v1/outreach/email/sender', {
      headers: winHeaders(),
    })
    expect(res.data).toMatchObject({
      localPart: 'johnny.goodparty',
      displayName: 'Johnny Goodparty',
      forwardToEmail: 'tests@goodparty.org',
      pendingForwardToEmail: null,
      warmingStep: 0,
    })
    expect(res.data.address).toMatch(/^johnny\.goodparty@outreachmail/)
  })

  it('prefers the campaign email for forwarding', async () => {
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { campaignEmail: 'team@jane.example' },
    })
    const res = await service.client.get('/v1/outreach/email/sender', {
      headers: winHeaders(),
    })
    expect(res.data.forwardToEmail).toBe('team@jane.example')
  })

  it('numbers the local part when another organization has it', async () => {
    await service.client.get('/v1/outreach/email/sender', {
      headers: winHeaders(),
    })
    const office = await service.client.get('/v1/outreach/serve/email/sender', {
      headers: serveHeaders(),
    })
    expect(office.data.localPart).toBe('johnny.goodparty2')
  })

  it('starts a confirmation instead of changing the forward-to address', async () => {
    const res = await service.client.patch(
      '/v1/outreach/email/sender',
      { forwardToEmail: 'New@Jane.example' },
      { headers: winHeaders() },
    )
    expect(res.data).toMatchObject({
      forwardToEmail: 'tests@goodparty.org',
      pendingForwardToEmail: 'new@jane.example',
    })
    const row = await service.prisma.outreachEmailSender.findUniqueOrThrow({
      where: { organizationSlug: winSlug },
    })
    expect(row.pendingForwardTokenHash).toHaveLength(64)
    expect(row.pendingForwardExpiresAt).not.toBeNull()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: 'new@jane.example',
    })
    expect(JSON.stringify(sendEmail.mock.calls[0]?.[0])).toContain(
      '/email/forward-confirm/',
    )
  })

  it('refuses a confirmation email on Win without Pro', async () => {
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: { isPro: false },
    })
    const res = await service.client.patch(
      '/v1/outreach/email/sender',
      { forwardToEmail: 'new@jane.example' },
      { headers: winHeaders(), validateStatus: () => true },
    )
    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  const changeTo = (path: string, headers: object, n: number) =>
    service.client.patch(
      path,
      { forwardToEmail: `new${n}@jane.example` },
      { headers, validateStatus: () => true },
    )

  it('sends 5 confirmation emails a day, then refuses the 6th', async () => {
    for (let n = 1; n <= 5; n++) {
      const ok = await changeTo('/v1/outreach/email/sender', winHeaders(), n)
      expect(ok.status).toBe(HttpStatus.OK)
    }
    const sixth = await changeTo('/v1/outreach/email/sender', winHeaders(), 6)
    expect(sixth.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(sixth.data.message).toBe(
      "You've changed your reply address too many times today. Try again tomorrow.",
    )
    expect(sendEmail).toHaveBeenCalledTimes(5)
  })

  it('counts each organization separately and only the last 24 hours', async () => {
    for (let n = 1; n <= 5; n++) {
      await changeTo('/v1/outreach/email/sender', winHeaders(), n)
    }
    const office = await changeTo(
      '/v1/outreach/serve/email/sender',
      serveHeaders(),
      1,
    )
    expect(office.status).toBe(HttpStatus.OK)

    await service.prisma.cronRun.updateMany({
      where: { jobName: `email-forward-confirm:${winSlug}` },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    })
    const again = await changeTo('/v1/outreach/email/sender', winHeaders(), 7)
    expect(again.status).toBe(HttpStatus.OK)
  })

  it('clears a pending change when the current address is requested again', async () => {
    await service.client.patch(
      '/v1/outreach/email/sender',
      { forwardToEmail: 'new@jane.example' },
      { headers: winHeaders() },
    )
    const res = await service.client.patch(
      '/v1/outreach/email/sender',
      { forwardToEmail: 'tests@goodparty.org' },
      { headers: winHeaders() },
    )
    expect(res.data.pendingForwardToEmail).toBeNull()
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('POST /:id/recipients (test upload)', () => {
  const draftId = async (): Promise<number> =>
    (await saveWin(draftBody())).data.id

  it('counts clean, duplicate, invalid, bad-domain and unsubscribed rows', async () => {
    findUndeliverableDomains.mockResolvedValue(new Set(['nxdomain.test']))
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'gone@example.com',
        organizationSlug: winSlug,
        reason: 'link',
      },
    })
    const id = await draftId()
    const res = await uploadTo(
      'email',
      id,
      [
        'Email,First Name,Last Name',
        'Ann@Example.com,Ann,Lee',
        'bob@example.com,Bob,',
        'ann@example.com,Ann,Dup',
        'not-an-email,X,Y',
        'ghost@nxdomain.test,G,H',
        'gone@example.com,Gone,Away',
      ].join('\n'),
    )
    expect(res.data).toEqual({
      ready: 2,
      invalid: 2,
      duplicate: 1,
      unsubscribed: 1,
    })

    const recipients = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmail: { outreachId: id } },
      orderBy: { id: 'asc' },
    })
    expect(recipients.map((r) => r.email)).toEqual([
      'ann@example.com',
      'bob@example.com',
    ])
    expect(recipients[0]).toMatchObject({ firstName: 'Ann', lastName: 'Lee' })

    const send = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { outreachId: id },
    })
    expect(send.consentConfirmedAt).not.toBeNull()
    expect(send.consentConfirmedByUserId).toBe(service.user.id)
  })

  it('ignores an unsubscribe that was undone', async () => {
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'back@example.com',
        organizationSlug: winSlug,
        reason: 'link',
        revokedAt: new Date(),
      },
    })
    const res = await uploadTo(
      'email',
      await draftId(),
      'email\nback@example.com',
    )
    expect(res.data).toMatchObject({ ready: 1, unsubscribed: 0 })
  })

  it('does not honor another organization’s unsubscribes', async () => {
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'other@example.com',
        organizationSlug: officeSlug,
        reason: 'link',
      },
    })
    const res = await uploadTo(
      'email',
      await draftId(),
      'email\nother@example.com',
    )
    expect(res.data).toMatchObject({ ready: 1, unsubscribed: 0 })
  })

  it('honors the campaign’s unsubscribes on an office send', async () => {
    await service.prisma.outreachEmailSuppression.create({
      data: {
        email: 'optout@example.com',
        organizationSlug: winSlug,
        reason: 'one_click',
      },
    })
    const serve = await saveServe(draftBody())
    const res = await uploadTo(
      'serve/email',
      serve.data.id,
      'email\noptout@example.com\nfine@example.com',
    )
    expect(res.data).toEqual({
      ready: 1,
      invalid: 0,
      duplicate: 0,
      unsubscribed: 1,
    })
  })

  it('replaces the draft’s recipients on a re-upload', async () => {
    const id = await draftId()
    await uploadTo('email', id, 'email\na@example.com\nb@example.com')
    const second = await uploadTo('email', id, 'email\nc@example.com')
    expect(second.data.ready).toBe(1)

    const emails = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmail: { outreachId: id } },
    })
    expect(emails.map((r) => r.email)).toEqual(['c@example.com'])
    const draft = await service.client.get(`/v1/outreach/email/${id}`, {
      headers: winHeaders(),
    })
    expect(draft.data.recipientCount).toBe(1)
  })

  it('requires consent', async () => {
    const id = await draftId()
    const missing = await uploadTo('email', id, 'email\na@example.com', {})
    const no = await uploadTo('email', id, 'email\na@example.com', {
      consentConfirmed: 'false',
    })
    expect(missing.status).toBe(HttpStatus.BAD_REQUEST)
    expect(no.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await service.prisma.outreachEmailRecipient.count()).toBe(0)
  })

  it('refuses a file over 5,000 rows and keeps the existing recipients', async () => {
    const id = await draftId()
    await uploadTo('email', id, 'email\nkeep@example.com')
    const big =
      'email\n' +
      Array.from({ length: 5001 }, (_, i) => `u${i}@example.com`).join('\n')
    const res = await uploadTo('email', id, big)
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await service.prisma.outreachEmailRecipient.count()).toBe(1)
  })

  it('answers a 4xx for a file over the size limit', async () => {
    const id = await draftId()
    const huge = 'email\n' + 'a@example.com\n'.repeat(200_000)
    const res = await uploadTo('email', id, huge)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('refuses a file with no email column', async () => {
    const res = await uploadTo('email', await draftId(), 'name\nAnn')
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('refuses uploads after the send is confirmed', async () => {
    const id = await draftId()
    await uploadTo('email', id, 'email\na@example.com')
    await service.prisma.outreach.update({
      where: { id },
      data: { status: OutreachStatus.pending },
    })
    const res = await uploadTo('email', id, 'email\nb@example.com')
    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(await service.prisma.outreachEmailRecipient.count()).toBe(1)
  })

  it('refuses another organization’s draft', async () => {
    const serve = await saveServe(draftBody())
    const res = await uploadTo('email', serve.data.id, 'email\na@example.com')
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
