/**
 * Outreach drafts: create + delete.
 *
 * Contract under test:
 *   - POST /v1/outreach/drafts persists a `draft` spine for a candidate who
 *     cannot send yet — no date, no phone list, no payment — and returns the
 *     OutreachDetail shape the history drawer reads.
 *   - A p2p draft arrives as multipart with its image; a robocall draft may
 *     arrive as multipart (no file) or as JSON, and reuses the create-time
 *     compliance + ETag gate.
 *   - One active draft per type per campaign: a second attempt 409s carrying
 *     the existing id so the client can resume instead.
 *   - DELETE /v1/outreach/:id removes a draft (S3 objects first, then the
 *     row), 409s any non-draft status, and 404s another campaign's row.
 *   - Neither route is Pro-gated and neither sits under
 *     OutreachNotificationInterceptor: a draft is not a send attempt.
 */

import { HttpStatus } from '@nestjs/common'
import FormData from 'form-data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { AreaCodeFromZipService } from '@/ai/util/areaCodeFromZip.util'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PeopleListResponse } from '@/contacts/schemas/person.schema'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import {
  calcRobocallTotalInCents,
  ROBOCALL_NUMBER_FEE_CENTS,
} from '@/shared/util/robocallPricing.util'
import { firstOrThrow } from '@/shared/test-utils/arrays.util'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'

const service = useTestService()

const CAMPAIGN_ID = 977
const AUDIO_ETAG = '"etag-draft-clip"'
const AUDIO_KEY = `robocall/${CAMPAIGN_ID}/draft-clip.webm`
const IMAGE_KEY = 'scheduled-campaign/jane-doe/p2p/draft/image.png'

const uploadFile = vi.fn()
const deleteObject = vi.fn()
const tcrFindFirstOrThrow = vi.fn()
const findContactsForFilter = vi.fn()

const peopleListWithTotal = (totalResults: number): PeopleListResponse => ({
  people: [],
  pagination: {
    totalResults,
    currentPage: 1,
    pageSize: 1,
    totalPages: totalResults > 0 ? 1 : 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

let orgSlug: string
let filterId: number

beforeEach(async () => {
  const s3 = service.app.get(S3Service)
  uploadFile.mockResolvedValue(`https://${ASSET_DOMAIN}/${IMAGE_KEY}`)
  deleteObject.mockResolvedValue(undefined)
  vi.spyOn(s3, 'uploadFile').mockImplementation(uploadFile)
  vi.spyOn(s3, 'deleteObject').mockImplementation(deleteObject)
  vi.spyOn(s3, 'headObject').mockResolvedValue({
    contentLength: 1,
    etag: AUDIO_ETAG,
  })

  orgSlug = `campaign-${CAMPAIGN_ID}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  // A free candidate: drafts are exactly what this candidate can do, so
  // nothing here may depend on Pro.
  await service.prisma.campaign.create({
    data: {
      id: CAMPAIGN_ID,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: false,
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })

  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug, name: 'saved list' },
  })
  filterId = filter.id

  await service.prisma.robocallComplianceResult.create({
    data: {
      audioKey: AUDIO_KEY,
      passed: true,
      checkedAt: new Date(),
      audioEtag: AUDIO_ETAG,
    },
  })
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const postForm = (form: FormData) =>
  service.client.post('/v1/outreach/drafts', form, {
    headers: { ...orgHeaders().headers, ...form.getHeaders() },
  })

const createP2pDraft = (name = 'Weekend texts') => {
  const form = new FormData()
  form.append('outreachType', 'p2p')
  form.append('name', name)
  form.append('voterFileFilterId', String(filterId))
  form.append('script', 'Hi {first_name}, this is Jane. Reply STOP to opt out.')
  form.append('file', Buffer.from('fake-image-bytes'), {
    filename: 'image.png',
    contentType: 'image/png',
  })
  return postForm(form)
}

const robocallDraftBody = () => ({
  outreachType: 'robocall',
  name: 'Robocall draft',
  voterFileFilterId: filterId,
  script: 'This is Jane, candidate for city council. Paid for by Jane.',
  audioKey: AUDIO_KEY,
  callbackNumber: '+15125550123',
})

describe('POST /v1/outreach/drafts', () => {
  it('creates a p2p draft for a free campaign with no send state', async () => {
    const res = await createP2pDraft()

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe(OutreachStatus.draft)
    expect(res.data.outreachType).toBe(OutreachType.p2p)
    expect(res.data.imageUrl).toBe(`https://${ASSET_DOMAIN}/${IMAGE_KEY}`)
    expect(res.data.voterFileFilterId).toBe(filterId)
    expect(res.data.date).toBeNull()
    expect(res.data.phoneListId).toBeNull()
    // The robocall block is the robocall satellite's resume fields; a
    // texting row has no satellite, so it must carry none.
    expect(res.data.robocall).toBeUndefined()

    const rows = await service.prisma.outreach.findMany({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.status).toBe(OutreachStatus.draft)
    expect(row?.organizationSlug).toBe(orgSlug)
    // The wizard writes the script into both columns, the way the send path
    // does, so a resume reads back what the candidate wrote.
    expect(row?.script).toContain('Reply STOP')
    expect(row?.message).toBe(row?.script)
    expect(row?.date).toBeNull()
    expect(row?.phoneListId).toBeNull()

    // The key has no send date to sit under — a draft has no date.
    expect(uploadFile).toHaveBeenCalledWith(
      ASSET_DOMAIN,
      expect.anything(),
      IMAGE_KEY,
      expect.objectContaining({ contentType: 'image/png' }),
    )
  })

  it('409s a second p2p draft with the existing draft id', async () => {
    const first = await createP2pDraft()
    expect(first.status).toBe(HttpStatus.CREATED)

    const second = await createP2pDraft('Another attempt')

    expect(second.status).toBe(HttpStatus.CONFLICT)
    expect(second.data.existingId).toBe(first.data.id)

    const rows = await service.prisma.outreach.findMany({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toHaveLength(1)
  })

  it('creates one row when two p2p creates race', async () => {
    // The cap is only real because the check and the insert share one
    // Serializable transaction: the loser either reads the winner's row or is
    // aborted with P2034, and both surface as the same 409.
    const [first, second] = await Promise.all([
      createP2pDraft('First'),
      createP2pDraft('Second'),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT].sort())

    const rows = await service.prisma.outreach.findMany({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toHaveLength(1)
  })

  it('does not upload the image when the cap rejects the create', async () => {
    const first = await createP2pDraft()
    expect(first.status).toBe(HttpStatus.CREATED)
    uploadFile.mockClear()

    const second = await createP2pDraft('Another attempt')

    expect(second.status).toBe(HttpStatus.CONFLICT)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('does not upload the image for a voter list the campaign does not own', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'upload-guard-org',
        ownerId: service.user.id,
        positionId: 'pos-4',
      },
    })
    const foreign = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: 'upload-guard-org', name: 'not yours' },
    })

    const form = new FormData()
    form.append('outreachType', 'p2p')
    form.append('name', 'Weekend texts')
    form.append('voterFileFilterId', String(foreign.id))
    form.append('script', 'Hi {first_name}. Reply STOP to opt out.')
    form.append('file', Buffer.from('fake-image-bytes'), {
      filename: 'image.png',
      contentType: 'image/png',
    })

    const res = await postForm(form)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(await service.prisma.outreach.count()).toBe(0)
  })

  it('creates a robocall draft with no billing on the satellite', async () => {
    const res = await service.client.post(
      '/v1/outreach/drafts',
      robocallDraftBody(),
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe(OutreachStatus.draft)
    expect(res.data.outreachType).toBe(OutreachType.robocall)
    expect(res.data.date).toBeNull()
    // The two satellite fields a resume cannot re-derive, and nothing else:
    // the resume's own create has to send them back.
    expect(res.data.robocall).toEqual({
      audioKey: AUDIO_KEY,
      callbackNumber: '+15125550123',
    })

    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: res.data.id },
    })
    expect(satellite.settleState).toBe(RobocallSettleState.draft)
    // Billing is derived at resume, not at draft: nothing is priced yet.
    expect(satellite.billableCount).toBeNull()
    expect(satellite.amountInCents).toBeNull()
    expect(satellite.audioKey).toBe(AUDIO_KEY)
    expect(satellite.complianceAudioEtag).toBe(AUDIO_ETAG)
    expect(satellite.compliancePassedAt).not.toBeNull()
  })

  it('accepts a robocall draft sent as multipart with no file', async () => {
    const body = robocallDraftBody()
    const form = new FormData()
    form.append('outreachType', body.outreachType)
    form.append('name', body.name)
    form.append('voterFileFilterId', String(body.voterFileFilterId))
    form.append('script', body.script)
    form.append('audioKey', body.audioKey)
    form.append('callbackNumber', body.callbackNumber)

    const res = await postForm(form)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe(OutreachStatus.draft)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('rejects a robocall draft whose audio never passed compliance', async () => {
    const res = await service.client.post(
      '/v1/outreach/drafts',
      {
        ...robocallDraftBody(),
        audioKey: `robocall/${CAMPAIGN_ID}/other.webm`,
      },
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await service.prisma.outreach.count()).toBe(0)
  })

  it('rejects a voter list owned by another organization', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'other-org',
        ownerId: service.user.id,
        positionId: 'pos-2',
      },
    })
    const foreign = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: 'other-org', name: 'not yours' },
    })

    const res = await service.client.post(
      '/v1/outreach/drafts',
      { ...robocallDraftBody(), voterFileFilterId: foreign.id },
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(await service.prisma.outreach.count()).toBe(0)
  })
})

describe('GET /v1/outreach', () => {
  it('lists the draft alongside sent outreach', async () => {
    const created = await createP2pDraft()

    const res = await service.client.get('/v1/outreach', orgHeaders())

    expect(res.status).toBe(HttpStatus.OK)
    const ids = res.data.map((row: { id: number }) => row.id)
    expect(ids).toContain(created.data.id)
  })
})

describe('GET /v1/outreach/:id', () => {
  it('reads a robocall draft back with its resume fields', async () => {
    const created = await service.client.post(
      '/v1/outreach/drafts',
      robocallDraftBody(),
      orgHeaders(),
    )
    expect(created.status).toBe(HttpStatus.CREATED)

    const res = await service.client.get(
      `/v1/outreach/${created.data.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    // The resume seeds audioKey and callbackNumber off this block; without
    // them its own create cannot be built.
    expect(res.data.robocall).toEqual({
      audioKey: AUDIO_KEY,
      callbackNumber: '+15125550123',
    })
  })

  it('returns no robocall block for a texting draft', async () => {
    const created = await createP2pDraft()

    const res = await service.client.get(
      `/v1/outreach/${created.data.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.robocall).toBeUndefined()
  })
})

describe('DELETE /v1/outreach/:id', () => {
  it('deletes the draft and its stored image', async () => {
    const created = await createP2pDraft()

    const res = await service.client.delete(
      `/v1/outreach/${created.data.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(deleteObject).toHaveBeenCalledWith(ASSET_DOMAIN, IMAGE_KEY)
    expect(
      await service.prisma.outreach.findUnique({
        where: { id: created.data.id },
      }),
    ).toBeNull()
  })

  it('deletes a robocall draft, its audio, and its compliance verdict', async () => {
    const created = await service.client.post(
      '/v1/outreach/drafts',
      robocallDraftBody(),
      orgHeaders(),
    )

    const res = await service.client.delete(
      `/v1/outreach/${created.data.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(deleteObject).toHaveBeenCalledWith(
      process.env.ROBOCALL_AUDIO_BUCKET,
      AUDIO_KEY,
    )
    expect(
      await service.prisma.outreachRobocall.findUnique({
        where: { outreachId: created.data.id },
      }),
    ).toBeNull()
    expect(
      await service.prisma.robocallComplianceResult.findUnique({
        where: { audioKey: AUDIO_KEY },
      }),
    ).toBeNull()
  })

  it('leaves an image that is not on the asset domain alone', async () => {
    const created = await createP2pDraft()
    // The expiry job runs this teardown over every draft row, including one
    // whose image this route did not write.
    await service.prisma.outreach.update({
      where: { id: created.data.id },
      data: { imageUrl: 'https://elsewhere.example/legacy/image.png' },
    })

    const res = await service.client.delete(
      `/v1/outreach/${created.data.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(deleteObject).not.toHaveBeenCalled()
    expect(
      await service.prisma.outreach.findUnique({
        where: { id: created.data.id },
      }),
    ).toBeNull()
  })

  it('409s a row that is not a draft', async () => {
    const pending = await service.prisma.outreach.create({
      data: {
        campaignId: CAMPAIGN_ID,
        organizationSlug: orgSlug,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        name: 'Already scheduled',
      },
    })

    const res = await service.client.delete(
      `/v1/outreach/${pending.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(deleteObject).not.toHaveBeenCalled()
    expect(
      await service.prisma.outreach.findUnique({ where: { id: pending.id } }),
    ).not.toBeNull()
  })

  it("404s another campaign's draft", async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'other-campaign-org',
        ownerId: service.user.id,
        positionId: 'pos-3',
      },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        id: CAMPAIGN_ID + 1,
        organizationSlug: 'other-campaign-org',
        userId: service.user.id,
        slug: 'john-roe',
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const foreignDraft = await service.prisma.outreach.create({
      data: {
        campaignId: otherCampaign.id,
        organizationSlug: 'other-campaign-org',
        outreachType: OutreachType.p2p,
        status: OutreachStatus.draft,
        name: 'Not yours',
      },
    })

    const res = await service.client.delete(
      `/v1/outreach/${foreignDraft.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(
      await service.prisma.outreach.findUnique({
        where: { id: foreignDraft.id },
      }),
    ).not.toBeNull()
  })
})

/**
 * Resume: the candidate saved a draft while they could not send, then became
 * Pro (and, for texting, cleared). Scheduling it converts THAT row —
 * `draft → pending_payment` — instead of inserting a second one, so the image,
 * script, and audience they saved are what gets sent.
 */
describe('resuming a draft', () => {
  const resumeScript =
    'Hello {first_name}, this is Johnny Goodparty. Vote for me. ' +
    'Paid for by Friends of Johnny. Reply STOP to opt out.'

  const sendAt = new Date(Date.now() + 7 * 86_400_000).toISOString()

  beforeEach(async () => {
    // The whole point of a resume: the candidate is Pro by now.
    await service.prisma.campaign.update({
      where: { id: CAMPAIGN_ID },
      data: { isPro: true },
    })

    const tcr = service.app.get(CampaignTcrComplianceService)
    vi.spyOn(tcr, 'findFirstOrThrow').mockImplementation(tcrFindFirstOrThrow)
    tcrFindFirstOrThrow.mockResolvedValue({ peerlyIdentityId: '11538886' })

    const areaCodes = service.app.get(AreaCodeFromZipService)
    vi.spyOn(areaCodes, 'getAreaCodeFromZip').mockResolvedValue(['512'])

    const contacts = service.app.get(ContactsService)
    vi.spyOn(contacts, 'findContactsForFilter').mockImplementation(
      findContactsForFilter,
    )
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(400))
  })

  // The body the webapp's review step sends on a resume: today's create body
  // plus draftOutreachId, and no file.
  const resumeP2p = (draftOutreachId: number) => {
    const form = new FormData()
    form.append('campaignId', String(CAMPAIGN_ID))
    form.append('outreachType', 'p2p')
    form.append('script', resumeScript)
    form.append('phoneListId', '3180213')
    form.append('voterFileFilterId', String(filterId))
    form.append('date', sendAt)
    form.append('scheduledLocalTime', '18:00')
    form.append('textCount', '5200')
    form.append('billableTextCount', '200')
    form.append('campaignPlanDueDate', '2026-04-19')
    form.append('draft', 'true')
    form.append('draftOutreachId', String(draftOutreachId))
    return service.client.post('/v1/outreach', form, {
      headers: { ...orgHeaders().headers, ...form.getHeaders() },
    })
  }

  const postRobocall = (body: object) =>
    service.client.post('/v1/outreach/robocall', body, orgHeaders())

  const robocallCreateBody = () => ({
    voterFileFilterId: filterId,
    audioKey: AUDIO_KEY,
    callbackNumber: '+15125550123',
    scheduledAt: sendAt.replace('Z', '+00:00'),
    script: 'This is Jane, candidate for city council. Paid for by Jane.',
  })

  const createRobocallDraft = () =>
    service.client.post(
      '/v1/outreach/drafts',
      robocallDraftBody(),
      orgHeaders(),
    )

  it('converts the p2p draft in place, with no file and no second row', async () => {
    const draft = await createP2pDraft()
    expect(draft.status).toBe(HttpStatus.CREATED)
    uploadFile.mockClear()

    const res = await resumeP2p(draft.data.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.id).toBe(draft.data.id)
    expect(res.data.status).toBe(OutreachStatus.pending_payment)
    // The draft's saved image is the one that sends; nothing re-uploads.
    expect(res.data.imageUrl).toBe(`https://${ASSET_DOMAIN}/${IMAGE_KEY}`)
    expect(uploadFile).not.toHaveBeenCalled()

    const rows = await service.prisma.outreach.findMany({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toHaveLength(1)
    const row = firstOrThrow(rows)
    expect(row.status).toBe(OutreachStatus.pending_payment)
    expect(row.phoneListId).toBe(3180213)
    expect(row.identityId).toBe('11538886')
    expect(row.date).not.toBeNull()
    expect(row.scheduledLocalDate).toBe(sendAt.slice(0, 10))
    expect(row.scheduledLocalTime).toBe('18:00')
    expect(row.textCount).toBe(5200)
    expect(row.billableTextCount).toBe(200)
    expect(row.campaignPlanDueDate).toBe('2026-04-19')
    expect(row.script).toBe(resumeScript)
    expect(row.message).toBe(resumeScript)
  })

  it('409s a p2p row that is no longer a draft', async () => {
    const pending = await service.prisma.outreach.create({
      data: {
        campaignId: CAMPAIGN_ID,
        organizationSlug: orgSlug,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending_payment,
        name: 'Already scheduled',
      },
    })

    const res = await resumeP2p(pending.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(await service.prisma.outreach.count()).toBe(1)
  })

  it("404s another campaign's p2p draft", async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'resume-other-org',
        ownerId: service.user.id,
        positionId: 'pos-9',
      },
    })
    const other = await service.prisma.campaign.create({
      data: {
        id: CAMPAIGN_ID + 2,
        organizationSlug: 'resume-other-org',
        userId: service.user.id,
        slug: 'john-roe',
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const foreignDraft = await service.prisma.outreach.create({
      data: {
        campaignId: other.id,
        organizationSlug: 'resume-other-org',
        outreachType: OutreachType.p2p,
        status: OutreachStatus.draft,
        name: 'Not yours',
      },
    })

    const res = await resumeP2p(foreignDraft.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    const untouched = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: foreignDraft.id },
    })
    expect(untouched.status).toBe(OutreachStatus.draft)
  })

  it('converts the robocall draft in place and fills its billing', async () => {
    const draft = await createRobocallDraft()
    expect(draft.status).toBe(HttpStatus.CREATED)

    const res = await postRobocall({
      ...robocallCreateBody(),
      draftOutreachId: draft.data.id,
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      outreachId: draft.data.id,
      billableCount: 400,
      amountInCents: calcRobocallTotalInCents(400),
      numberFeeInCents: ROBOCALL_NUMBER_FEE_CENTS,
    })

    expect(await service.prisma.outreach.count()).toBe(1)
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: draft.data.id },
    })
    expect(spine.status).toBe(OutreachStatus.pending_payment)
    expect(spine.date).not.toBeNull()
    expect(spine.scheduledLocalDate).toBe(sendAt.slice(0, 10))

    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: draft.data.id },
    })
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.billableCount).toBe(400)
    expect(satellite.amountInCents).toBe(calcRobocallTotalInCents(400))
    expect(satellite.audioKey).toBe(AUDIO_KEY)
    expect(satellite.complianceAudioEtag).toBe(AUDIO_ETAG)
    expect(satellite.compliancePassedAt).not.toBeNull()
  })

  it('409s a robocall create that reuses a draft recording without resuming it', async () => {
    const draft = await createRobocallDraft()
    expect(draft.status).toBe(HttpStatus.CREATED)

    const res = await postRobocall(robocallCreateBody())

    expect(res.status).toBe(HttpStatus.CONFLICT)
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: draft.data.id },
    })
    expect(spine.status).toBe(OutreachStatus.draft)
    expect(await service.prisma.outreach.count()).toBe(1)
  })

  it('409s a robocall row that is no longer a draft', async () => {
    const draft = await createRobocallDraft()
    await service.prisma.outreach.update({
      where: { id: draft.data.id },
      data: { status: OutreachStatus.pending },
    })

    const res = await postRobocall({
      ...robocallCreateBody(),
      draftOutreachId: draft.data.id,
    })

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it("404s another campaign's robocall draft", async () => {
    const draft = await createRobocallDraft()
    await service.prisma.organization.create({
      data: {
        slug: 'resume-robocall-org',
        ownerId: service.user.id,
        positionId: 'pos-10',
      },
    })
    const other = await service.prisma.campaign.create({
      data: {
        id: CAMPAIGN_ID + 3,
        organizationSlug: 'resume-robocall-org',
        userId: service.user.id,
        slug: 'jane-roe',
        isPro: true,
        details: {},
        data: {},
        aiContent: {},
      },
    })
    // The audio prefix check is campaign-scoped, so the foreign caller sends
    // its own key; the draft it names still belongs to someone else.
    const foreignAudioKey = `robocall/${other.id}/clip.webm`
    await service.prisma.robocallComplianceResult.create({
      data: {
        audioKey: foreignAudioKey,
        passed: true,
        checkedAt: new Date(),
        audioEtag: AUDIO_ETAG,
      },
    })
    const foreignFilter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: 'resume-robocall-org', name: 'their list' },
    })

    const res = await service.client.post(
      '/v1/outreach/robocall',
      {
        ...robocallCreateBody(),
        voterFileFilterId: foreignFilter.id,
        audioKey: foreignAudioKey,
        draftOutreachId: draft.data.id,
      },
      { headers: { 'x-organization-slug': 'resume-robocall-org' } },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: draft.data.id },
    })
    expect(spine.status).toBe(OutreachStatus.draft)
    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: draft.data.id },
    })
    expect(satellite.settleState).toBe(RobocallSettleState.draft)
    expect(satellite.billableCount).toBeNull()
  })

  it('409s the second of two concurrent p2p resumes, converting once', async () => {
    const draft = await createP2pDraft()
    expect(draft.status).toBe(HttpStatus.CREATED)

    // Both requests clear the status read, so only the `draft`-guarded write
    // keeps one of them from silently overwriting the other.
    const [first, second] = await Promise.all([
      resumeP2p(draft.data.id),
      resumeP2p(draft.data.id),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT].sort())
    expect(await service.prisma.outreach.count()).toBe(1)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: draft.data.id },
    })
    expect(row.status).toBe(OutreachStatus.pending_payment)
  })

  it('409s a second robocall resume of the same draft', async () => {
    const draft = await createRobocallDraft()
    const body = { ...robocallCreateBody(), draftOutreachId: draft.data.id }

    const first = await postRobocall(body)
    expect(first.status).toBe(HttpStatus.CREATED)

    const second = await postRobocall(body)

    expect(second.status).toBe(HttpStatus.CONFLICT)
    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: draft.data.id },
    })
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
  })

  it('403s a p2p resume for a campaign that is not Pro', async () => {
    const draft = await createP2pDraft()
    expect(draft.status).toBe(HttpStatus.CREATED)
    // Pro is what a resume is waiting on, and the body need not carry a saved
    // list — so the gate cannot hang off the list's own Pro check.
    await service.prisma.campaign.update({
      where: { id: CAMPAIGN_ID },
      data: { isPro: false },
    })

    const form = new FormData()
    form.append('campaignId', String(CAMPAIGN_ID))
    form.append('outreachType', 'p2p')
    form.append('script', resumeScript)
    form.append('phoneListId', '3180213')
    form.append('date', sendAt)
    form.append('draft', 'true')
    form.append('draftOutreachId', String(draft.data.id))

    const res = await service.client.post('/v1/outreach', form, {
      headers: { ...orgHeaders().headers, ...form.getHeaders() },
    })

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: draft.data.id },
    })
    expect(row.status).toBe(OutreachStatus.draft)
    expect(row.phoneListId).toBeNull()
    expect(row.date).toBeNull()
  })
})
