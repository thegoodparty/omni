import { EmailContentDraftSchema } from '@goodparty_org/contracts'
import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subDays } from 'date-fns'
import { AnalyticsService } from '@/analytics/analytics.service'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { LlmService } from '@/llm/services/llm.service'
import { DRAFT_RETENTION_DAYS } from '@/outreach/services/outreachDraftExpiry.service'
import { appEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OutreachStatus } from '../../generated/prisma'
import { SesService } from '../services/ses.service'
import { OutreachEmailProfileService } from '../services/outreachEmailProfile.service'

const service = useTestService({ jobs: true })

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
    expect(res.data).toEqual({
      ...aiDraftReply,
      content: {
        layout: 'long_update',
        theme: 'neutral',
        subject: 'Join us Thursday',
        blocks: [
          { type: 'heading', text: 'Town hall', level: 1 },
          { type: 'paragraph', text: 'Hello {{first_name}},' },
          { type: 'paragraph', text: 'Come say hello.' },
        ],
      },
    })
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

  it('asks for a button only for a clear online action', async () => {
    await post('/v1/outreach/email/draft', draftRequest(), winHeaders())
    const system = String(jsonCompletion.mock.calls[0]?.[0].messages[0].content)
    expect(system).toContain('only when the goal of the email has a clear')
    expect(system).toContain('never write a URL')
    expect(promptsOf()).not.toMatch(/needs a button|must be set/)
  })

  it('always asks a fresh draft for a title, and lets Improve keep none', async () => {
    await post('/v1/outreach/email/draft', draftRequest(), winHeaders())
    await post(
      '/v1/outreach/email/draft',
      draftRequest({ currentDraft: { ...aiDraftReply, headline: null } }),
      winHeaders(),
    )
    const [fresh, improve] = jsonCompletion.mock.calls.map(([call]) => call)
    const untitled = { ...aiDraftReply, headline: null }
    expect(String(fresh.messages[0].content)).toContain('Always set it')
    expect(String(fresh.messages[1].content)).toContain('Layout: Long update.')
    expect(fresh.schema.safeParse(untitled).success).toBe(false)
    expect(
      fresh.schema.safeParse({ ...aiDraftReply, headline: 'x'.repeat(121) })
        .success,
    ).toBe(false)
    expect(improve.schema.safeParse(untitled).success).toBe(true)
  })

  it('puts the title in a personal letter as its level 1 heading', async () => {
    const res = await post(
      '/v1/outreach/email/draft',
      draftRequest({ layout: 'personal_letter' }),
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.content.blocks).toEqual([
      { type: 'heading', text: 'Town hall', level: 1 },
      { type: 'paragraph', text: 'Hello {{first_name}},' },
      { type: 'paragraph', text: 'Come say hello.' },
    ])
  })

  it.each(['short_cta', 'call_to_action'])(
    'adds no button to a %s draft the model left without one',
    async (layout) => {
      const res = await post(
        '/v1/outreach/email/draft',
        draftRequest({ layout }),
        winHeaders(),
      )
      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.buttonLabel).toBeNull()
      expect(res.data.content.blocks).not.toContainEqual(
        expect.objectContaining({ type: 'button' }),
      )
    },
  )

  it('returns blocks for a layout preset in the requested theme', async () => {
    jsonCompletion.mockResolvedValue({
      object: { ...aiDraftReply, buttonLabel: 'Save your spot' },
      tokens: 1,
    })
    const res = await post(
      '/v1/outreach/serve/email/draft',
      draftRequest({ layout: 'short_cta', theme: 'warm_sunset' }),
      serveHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.content).toEqual({
      layout: 'short_cta',
      theme: 'warm_sunset',
      subject: 'Join us Thursday',
      blocks: [
        { type: 'heading', text: 'Town hall', level: 1 },
        { type: 'paragraph', text: 'Hello {{first_name}},\n\nCome say hello.' },
        { type: 'button', label: 'Save your spot', url: '' },
      ],
    })
  })

  it('writes both texts of a photo_letter in one request', async () => {
    jsonCompletion.mockResolvedValue({
      object: {
        ...aiDraftReply,
        body2: 'Bring a neighbor.',
        buttonLabel: 'Save your spot',
      },
      tokens: 1,
    })
    const res = await post(
      '/v1/outreach/email/draft',
      draftRequest({ layout: 'photo_letter' }),
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const [call] = jsonCompletion.mock.calls[0] ?? []
    expect(String(call.messages[1].content)).toContain('Also reply with body2')
    expect(call.schema.safeParse(aiDraftReply).success).toBe(false)
    expect(res.data).toEqual({
      ...aiDraftReply,
      body2: 'Bring a neighbor.',
      buttonLabel: 'Save your spot',
      content: {
        layout: 'photo_letter',
        theme: 'cyan',
        subject: 'Join us Thursday',
        blocks: [
          { type: 'heading', text: 'Town hall', level: 1 },
          {
            type: 'paragraph',
            text: 'Hello {{first_name}},\n\nCome say hello.',
          },
          { type: 'paragraph', text: 'Bring a neighbor.' },
          { type: 'button', label: 'Save your spot', url: '' },
        ],
      },
    })
  })

  it('polishes both texts of a photo_letter together', async () => {
    jsonCompletion.mockResolvedValue({
      object: { ...aiDraftReply, body2: 'Bring a friend.' },
      tokens: 1,
    })
    const res = await post(
      '/v1/outreach/email/draft',
      draftRequest({
        layout: 'photo_letter',
        currentDraft: { ...aiDraftReply, body2: 'bring a frend' },
      }),
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    const prompts = promptsOf()
    expect(prompts).toContain('bring a frend')
    expect(prompts).toContain('keep it consistent with body')
    expect(res.data.body2).toBe('Bring a friend.')
  })

  it('asks the original layouts for one body, as before', async () => {
    await post('/v1/outreach/email/draft', draftRequest(), winHeaders())
    const [call] = jsonCompletion.mock.calls[0] ?? []
    expect(promptsOf()).not.toContain('body2')
    expect(
      call.schema.safeParse({ ...aiDraftReply, body2: 'x' }).data,
    ).not.toHaveProperty('body2')
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

  it('holds a signature image to the same rule, in a draft and a preview', async () => {
    const contentWith = (imageUrl: string) => ({
      layout: 'photo_letter',
      theme: 'cyan',
      subject: 's',
      blocks: [
        { type: 'paragraph', text: 'Hello' },
        { type: 'signature', name: 'Jane Doe', imageUrl },
      ],
    })
    const own = `https://${ASSET_DOMAIN}/email-images/${winSlug}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png`
    const elsewhere = 'https://example.com/signature.png'
    const save = (imageUrl: string) =>
      post(
        '/v1/outreach/email',
        { goal: 'g', content: contentWith(imageUrl) },
        winHeaders(),
      )
    const preview = (imageUrl: string) =>
      post(
        '/v1/outreach/email/preview',
        { content: contentWith(imageUrl) },
        winHeaders(),
      )
    expect((await save(elsewhere)).status).toBe(HttpStatus.BAD_REQUEST)
    expect((await preview(elsewhere)).status).toBe(HttpStatus.BAD_REQUEST)
    expect((await save(own)).status).toBe(HttpStatus.CREATED)
    const rendered = await preview(own)
    expect(rendered.status).toBe(HttpStatus.CREATED)
    expect(rendered.data.html).toContain(own)
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

    await service.jobs.runSchedule('outreachDraftExpiry')

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

describe('the signature profile link', () => {
  const slug = 'jane-doe-1a2b3c4d'
  const liveUrl = `https://dev.goodparty.org/people/${slug}`
  const sentByClient = 'https://goodparty.org/people/someone-else-9f8e7d6c'

  const letter = {
    layout: 'photo_letter',
    theme: 'cyan',
    subject: 'Town hall',
    blocks: [
      { type: 'paragraph', text: 'Hello {{first_name}}' },
      { type: 'signature', name: 'Jane Doe', profileUrl: sentByClient },
    ],
  }

  const publishProfile = async () => {
    const personId = randomUUID()
    await service.prisma.personProfile.create({
      data: { personId, userId: service.user.id, publishedAt: new Date() },
    })
    vi.spyOn(service.app.get(PersonsService), 'getPersons').mockResolvedValue([
      { id: personId, slug },
    ] as Awaited<ReturnType<PersonsService['getPersons']>>)
  }

  const signatureOf = (content: { blocks: { type: string }[] }) =>
    content.blocks.find((block) => block.type === 'signature')

  beforeEach(() => {
    appEnvOverrides.WEBAPP_ROOT = 'https://dev.goodparty.org'
  })

  it.each([
    ['Win', '/v1/outreach/email', winHeaders],
    ['Serve', '/v1/outreach/serve/email', serveHeaders],
  ])(
    'links the %s sender’s public profile, whatever the client sent',
    async (_mode, path, headers) => {
      await publishProfile()
      const saved = await post(path, { goal: 'g', content: letter }, headers())
      expect(saved.status).toBe(HttpStatus.CREATED)
      expect(signatureOf(saved.data.content)).toMatchObject({
        profileUrl: liveUrl,
      })
      const preview = await post(
        `${path}/preview`,
        { content: letter },
        headers(),
      )
      expect(preview.data.html).toContain(`href="${liveUrl}"`)
      expect(preview.data.html).not.toContain(sentByClient)

      const test = await post(`${path}/${saved.data.id}/test`, {}, headers())
      expect(test.status).toBe(HttpStatus.CREATED)
      expect(sendEmail.mock.calls[0]?.[0].html).toContain(`href="${liveUrl}"`)
    },
  )

  it('leaves the link out when the sender has no public profile', async () => {
    const saved = await post(
      '/v1/outreach/email',
      { goal: 'g', content: letter },
      winHeaders(),
    )
    expect(saved.status).toBe(HttpStatus.CREATED)
    expect(signatureOf(saved.data.content)).toMatchObject({ profileUrl: '' })
    const preview = await post(
      '/v1/outreach/email/preview',
      { content: letter },
      winHeaders(),
    )
    expect(preview.data.html).toContain('Jane Doe')
    expect(preview.data.html).not.toContain('My public profile')
    expect(preview.data.html).not.toContain(sentByClient)
  })

  it('fails prepare, not the preview, when the address cannot be resolved', async () => {
    await service.prisma.personProfile.create({
      data: {
        personId: randomUUID(),
        userId: service.user.id,
        publishedAt: new Date(),
      },
    })
    vi.spyOn(service.app.get(PersonsService), 'getPersons').mockResolvedValue(
      [],
    )
    const preview = await post(
      '/v1/outreach/email/preview',
      { content: letter },
      winHeaders(),
    )
    expect(preview.data.html).not.toContain('My public profile')

    const profiles = service.app.get(OutreachEmailProfileService)
    await expect(
      profiles.withProfileUrl(winSlug, EmailContentDraftSchema.parse(letter), {
        requireResolved: true,
      }),
    ).rejects.toThrow('could not be resolved')
  })

  it('leaves the link out while the profile is unpublished', async () => {
    await service.prisma.personProfile.create({
      data: { personId: randomUUID(), userId: service.user.id },
    })
    const preview = await post(
      '/v1/outreach/serve/email/preview',
      { content: letter },
      serveHeaders(),
    )
    expect(preview.data.html).not.toContain('My public profile')
  })
})
