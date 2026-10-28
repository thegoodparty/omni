import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subDays } from 'date-fns'
import { AnalyticsService } from '@/analytics/analytics.service'
import { LlmService } from '@/llm/services/llm.service'
import { DRAFT_RETENTION_DAYS } from '@/outreach/services/outreachDraftExpiry.service'
import { OutreachDraftExpiryService } from '@/outreach/services/outreachDraftExpiry.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OutreachStatus } from '../../generated/prisma'
import { SesService } from '../services/ses.service'

const service = useTestService()

let winSlug: string
let officeSlug: string
let campaignId: number

const jsonCompletion = vi.fn()
const track = vi.fn()
const sendEmail = vi.fn()

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const winHeaders = () => ({ 'x-organization-slug': winSlug })
const serveHeaders = () => ({ 'x-organization-slug': officeSlug })
const post = (path: string, body: object, headers: object) =>
  service.client.post(path, body, { headers, validateStatus: () => true })

const aiDraftReply = {
  subject: 'Join us Thursday',
  headline: 'Town hall',
  body: 'Hello {{first_name}},\n\nCome say hello.',
  buttonLabel: null,
}

beforeEach(async () => {
  jsonCompletion
    .mockReset()
    .mockResolvedValue({ object: aiDraftReply, tokens: 1 })
  track.mockReset().mockResolvedValue(undefined)
  sendEmail.mockReset().mockResolvedValue('message-id')
  vi.spyOn(service.app.get(LlmService), 'jsonCompletion').mockImplementation(
    jsonCompletion,
  )
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(track)
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

const draftRequest = (overrides: object = {}) => ({
  goal: 'Invite neighbors to the town hall',
  tone: 'warm',
  layout: 'newsletter',
  ...overrides,
})

const promptsOf = (): string =>
  JSON.stringify(jsonCompletion.mock.calls[0]?.[0].messages)

describe('POST /draft (AI draft)', () => {
  it('writes a Win draft in the candidate voice and tracks the event', async () => {
    const res = await post(
      '/v1/outreach/email/draft',
      draftRequest(),
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual(aiDraftReply)
    const prompts = promptsOf()
    expect(prompts).toContain('independent')
    expect(prompts).toContain('Invite neighbors to the town hall')
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Email.DraftCompleted,
      { mode: 'win', layout: 'newsletter', tone: 'warm', improved: false },
    )
  })

  it('writes a Serve draft that never says voters or candidate', async () => {
    const res = await post(
      '/v1/outreach/serve/email/draft',
      draftRequest(),
      serveHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    const system = String(jsonCompletion.mock.calls[0]?.[0].messages[0].content)
    expect(system).toContain('constituents')
    expect(system).not.toMatch(/independent|non-partisan local candidate/)
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Email.DraftCompleted,
      expect.objectContaining({ mode: 'serve' }),
    )
  })

  it('polishes the current draft when one is sent', async () => {
    const res = await post(
      '/v1/outreach/email/draft',
      draftRequest({ currentDraft: aiDraftReply }),
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(promptsOf()).toContain('polish')
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Email.DraftCompleted,
      expect.objectContaining({ improved: true }),
    )
  })

  it('always returns a button label on a layout that needs one', async () => {
    const res = await post(
      '/v1/outreach/email/draft',
      draftRequest({ layout: 'call_to_action' }),
      winHeaders(),
    )
    expect(res.data.buttonLabel).toBe('Learn more')
  })

  it('answers 502 when the model fails, without tracking', async () => {
    jsonCompletion.mockRejectedValue(new Error('boom'))
    const res = await post(
      '/v1/outreach/email/draft',
      draftRequest(),
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    expect(track).not.toHaveBeenCalled()
  })

  it('rejects an unknown layout and a missing goal', async () => {
    const badLayout = await post(
      '/v1/outreach/email/draft',
      draftRequest({ layout: 'nope' }),
      winHeaders(),
    )
    expect(badLayout.status).toBe(HttpStatus.BAD_REQUEST)
    const noGoal = await post(
      '/v1/outreach/email/draft',
      draftRequest({ goal: ' ' }),
      winHeaders(),
    )
    expect(noGoal.status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('POST /images/presign', () => {
  it('presigns a size-capped upload under the organization and returns the permanent URL', async () => {
    const createPresignedUpload = vi
      .spyOn(service.app.get(S3Service), 'createPresignedUpload')
      .mockResolvedValue({ url: 'https://s3.test', fields: { a: 'b' } })
    const res = await post(
      '/v1/outreach/email/images/presign',
      { contentType: 'image/png' },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(createPresignedUpload).toHaveBeenCalledWith(
      ASSET_DOMAIN,
      expect.stringMatching(new RegExp(`^email-images/${winSlug}/.+\\.png$`)),
      expect.objectContaining({
        contentType: 'image/png',
        maxBytes: 1_000_000,
      }),
    )
    expect(res.data.publicUrl).toMatch(
      new RegExp(`^https://${ASSET_DOMAIN}/email-images/${winSlug}/.+\\.png$`),
    )
  })

  it('refuses types other than JPG, PNG and GIF', async () => {
    const res = await post(
      '/v1/outreach/serve/email/images/presign',
      { contentType: 'image/webp' },
      serveHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('only lets a draft keep an image presigned for its own organization', async () => {
    const body = {
      goal: 'g',
      layout: 'newsletter',
      theme: 'classic_blue',
      subject: 's',
      body: 'b',
    }
    const elsewhere = await post(
      '/v1/outreach/email',
      { ...body, imageUrl: 'https://example.com/a.png' },
      winHeaders(),
    )
    expect(elsewhere.status).toBe(HttpStatus.BAD_REQUEST)
    const otherOrg = await post(
      '/v1/outreach/email',
      {
        ...body,
        imageUrl: `https://${ASSET_DOMAIN}/email-images/someone-else/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`,
      },
      winHeaders(),
    )
    expect(otherOrg.status).toBe(HttpStatus.BAD_REQUEST)
    const traversal = await post(
      '/v1/outreach/email',
      {
        ...body,
        imageUrl: `https://${ASSET_DOMAIN}/email-images/${winSlug}/../x/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`,
      },
      winHeaders(),
    )
    expect(traversal.status).toBe(HttpStatus.BAD_REQUEST)
    const own = await post(
      '/v1/outreach/email',
      {
        ...body,
        imageUrl: `https://${ASSET_DOMAIN}/email-images/${winSlug}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`,
      },
      winHeaders(),
    )
    expect(own.status).toBe(HttpStatus.CREATED)
  })
})

describe('POST /:id/test (test send)', () => {
  const saveDraft = async (
    path: string,
    headers: object,
    overrides: object = {},
  ): Promise<number> => {
    const res = await post(
      path,
      {
        goal: 'g',
        layout: 'newsletter',
        theme: 'classic_blue',
        subject: 'Town hall',
        body: 'Hello {{first_name}}, see you there.',
        ...overrides,
      },
      headers,
    )
    return res.data.id
  }

  it('sends one rendered email to the login address, with merge tags filled and no tenant yet', async () => {
    const id = await saveDraft('/v1/outreach/email', winHeaders())
    const res = await post(`/v1/outreach/email/${id}/test`, {}, winHeaders())
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ sentTo: service.user.email })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const sent = sendEmail.mock.calls[0]?.[0]
    expect(sent.to).toBe(service.user.email)
    expect(sent.subject).toBe('[Test] Town hall')
    expect(sent.tenantName).toBeUndefined()
    expect(sent.from).toContain('@')
    expect(sent.html).not.toContain('{{first_name}}')
    expect(sent.html).not.toContain('{{unsubscribe_url}}')
    expect(sent.text).not.toContain('{{')
  })

  it('goes through the organization tenant once it has one', async () => {
    const id = await saveDraft('/v1/outreach/email', winHeaders())
    await service.prisma.outreachEmailSender.update({
      where: { organizationSlug: winSlug },
      data: { sesTenantName: `test-${winSlug}` },
    })
    await post(`/v1/outreach/email/${id}/test`, {}, winHeaders())
    expect(sendEmail.mock.calls[0]?.[0].tenantName).toBe(`test-${winSlug}`)
  })

  it('works for Serve and is scoped to the office', async () => {
    const id = await saveDraft('/v1/outreach/serve/email', serveHeaders())
    const own = await post(
      `/v1/outreach/serve/email/${id}/test`,
      {},
      serveHeaders(),
    )
    expect(own.status).toBe(HttpStatus.CREATED)
    const crossed = await post(
      `/v1/outreach/email/${id}/test`,
      {},
      winHeaders(),
    )
    expect(crossed.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('refuses a send that has left draft, and sends nothing', async () => {
    const id = await saveDraft('/v1/outreach/email', winHeaders())
    await service.prisma.outreach.update({
      where: { id },
      data: { status: OutreachStatus.pending },
    })
    const res = await post(`/v1/outreach/email/${id}/test`, {}, winHeaders())
    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('draft expiry', () => {
  it('deletes the uploaded image of an expired email draft', async () => {
    const created = await post(
      '/v1/outreach/email',
      {
        goal: 'g',
        layout: 'newsletter',
        theme: 'classic_blue',
        subject: 's',
        body: 'b',
        imageUrl: `https://${ASSET_DOMAIN}/email-images/${winSlug}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png`,
      },
      winHeaders(),
    )
    await service.prisma.outreach.update({
      where: { id: created.data.id },
      data: { createdAt: subDays(new Date(), DRAFT_RETENTION_DAYS + 1) },
    })
    const deleteObject = vi
      .spyOn(service.app.get(S3Service), 'deleteObject')
      .mockResolvedValue(undefined)

    await service.app.get(OutreachDraftExpiryService).expireDrafts()

    expect(deleteObject).toHaveBeenCalledWith(
      ASSET_DOMAIN,
      `email-images/${winSlug}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png`,
    )
    expect(
      await service.prisma.outreach.findUnique({
        where: { id: created.data.id },
      }),
    ).toBeNull()
  })
})
