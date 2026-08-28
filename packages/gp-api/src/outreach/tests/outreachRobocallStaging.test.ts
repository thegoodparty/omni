import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { addHours, subMinutes } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallStagingService } from '@/outreach/services/outreachRobocallStaging.service'
import { RobocallPhonebookService } from '@/outreach/services/robocallPhonebook.service'
import { CallhubMediaService } from '@/vendors/callhub/services/callhubMedia.service'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let staging: OutreachRobocallStagingService
let loadAudienceSpy: ReturnType<typeof vi.spyOn>
let uploadMediaSpy: ReturnType<typeof vi.spyOn>
let createVbSpy: ReturnType<typeof vi.spyOn>
let getBytesSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const vbResult = (pkStr: string) => ({
  pk_str: pkStr,
  name: 'Robocall jane-doe',
  startingDate: new Date('2026-09-16T13:18:21Z'),
  expirationDate: new Date('2026-09-23T13:18:21Z'),
})

beforeEach(async () => {
  staging = service.app.get(OutreachRobocallStagingService)

  loadAudienceSpy = vi
    .spyOn(service.app.get(RobocallPhonebookService), 'loadAudienceToPhonebook')
    .mockResolvedValue({ phonebookPkStr: 'pb_1', importedCount: 100 })
  uploadMediaSpy = vi
    .spyOn(service.app.get(CallhubMediaService), 'uploadMedia')
    .mockResolvedValue({ media_file_id: 'media_1' })
  createVbSpy = vi
    .spyOn(service.app.get(CallhubCampaignService), 'createVoiceBroadcast')
    .mockResolvedValue(vbResult('vb_1'))
  getBytesSpy = vi
    .spyOn(service.app.get(S3Service), 'getFileBytesWithContentType')
    .mockResolvedValue({
      bytes: Buffer.from('audio'),
      contentType: 'audio/mpeg',
    })

  const campaignId = 998
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: { state: 'TX', city: 'Georgetown', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug },
  })
  filterId = filter.id
})

const createDraft = async ({
  sendInHours = 1,
  settleState = RobocallSettleState.authorized,
  callhubCampaignPkStr,
}: {
  sendInHours?: number
  settleState?: RobocallSettleState
  callhubCampaignPkStr?: string
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addHours(new Date(), sendInHours),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/998/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      ...(callhubCampaignPkStr ? { callhubCampaignPkStr } : {}),
    },
  })
  return spine.id
}

// @updatedAt is client-managed, so a stale claim can only be simulated with a
// raw write to the underlying column.
const ageStagingRow = (outreachId: number, minutes: number) =>
  service.prisma.$executeRaw`
    UPDATE outreach_robocall
    SET updated_at = ${subMinutes(new Date(), minutes)}
    WHERE outreach_id = ${outreachId}
  `

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

const loggerErrorSpy = () =>
  vi.spyOn((staging as unknown as { logger: PinoLogger }).logger, 'error')

describe('OutreachRobocallStagingService.stageCampaign', () => {
  it('stages an authorized draft and persists the CallHub campaign', async () => {
    const outreachId = await createDraft()

    await staging.stageCampaign(outreachId)

    expect(loadAudienceSpy).toHaveBeenCalledTimes(1)
    expect(createVbSpy).toHaveBeenCalledTimes(1)
    // pk_str is carried as a STRING end-to-end, never coerced to a number.
    const vbArgs = createVbSpy.mock.calls[0]?.[0]
    expect(vbArgs).toMatchObject({
      phonebookPkStr: 'pb_1',
      mediaFileId: 'media_1',
      callerId: '+15125550123',
    })

    const satellite = await readSatellite(outreachId)
    expect(satellite.callhubCampaignPkStr).toBe('vb_1')
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    // The computed window is persisted, never null on a successful stage.
    expect(satellite.callhubStartingDate).not.toBeNull()
    expect(satellite.callhubExpirationDate).not.toBeNull()
  })

  it('uploads media before creating the phonebook (cheap format failure)', async () => {
    const outreachId = await createDraft()

    await staging.stageCampaign(outreachId)

    // Blast-radius order: an unsupported format would reject at uploadMedia
    // before loadAudienceToPhonebook creates any external phonebook state.
    const uploadOrder = uploadMediaSpy.mock.invocationCallOrder[0] ?? 0
    const phonebookOrder = loadAudienceSpy.mock.invocationCallOrder[0] ?? 0
    expect(uploadOrder).toBeLessThan(phonebookOrder)
  })

  it('is idempotent: an already-staged draft is skipped', async () => {
    const outreachId = await createDraft({
      callhubCampaignPkStr: 'vb_existing',
    })

    await staging.stageCampaign(outreachId)

    expect(createVbSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.callhubCampaignPkStr).toBe('vb_existing')
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
  })

  it('skips a draft that is not authorized', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.pending_payment,
    })

    await staging.stageCampaign(outreachId)

    expect(createVbSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.callhubCampaignPkStr).toBeNull()
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
  })

  it('reverts the claim to authorized and 502s on a CallHub failure', async () => {
    const outreachId = await createDraft()
    createVbSpy.mockRejectedValueOnce(
      new BadGatewayException('CallHub voice broadcast creation failed'),
    )

    await expect(staging.stageCampaign(outreachId)).rejects.toBeInstanceOf(
      BadGatewayException,
    )

    // No stranded claim: the draft is back to authorized with no campaign.
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.callhubCampaignPkStr).toBeNull()
  })

  it('502s and reverts when the audio object is missing', async () => {
    const outreachId = await createDraft()
    getBytesSpy.mockResolvedValueOnce(undefined)

    await expect(staging.stageCampaign(outreachId)).rejects.toBeInstanceOf(
      BadGatewayException,
    )

    // Fails before any external phonebook/media/campaign state is created.
    expect(uploadMediaSpy).not.toHaveBeenCalled()
    expect(loadAudienceSpy).not.toHaveBeenCalled()
    expect(createVbSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
  })

  it('502s and reverts when the audio has no content type', async () => {
    const outreachId = await createDraft()
    getBytesSpy.mockResolvedValueOnce({
      bytes: Buffer.from('audio'),
      contentType: undefined,
    })

    await expect(staging.stageCampaign(outreachId)).rejects.toBeInstanceOf(
      BadGatewayException,
    )

    expect(uploadMediaSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
  })

  it('places only one campaign under a concurrent double-stage', async () => {
    const outreachId = await createDraft()

    await Promise.all([
      staging.stageCampaign(outreachId),
      staging.stageCampaign(outreachId),
    ])

    // The claim CAS elects a single stager, so exactly one CallHub campaign is
    // created even when two runners race the same draft.
    expect(createVbSpy).toHaveBeenCalledTimes(1)
    const satellite = await readSatellite(outreachId)
    expect(satellite.callhubCampaignPkStr).toBe('vb_1')
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
  })

  it('logs an orphan and creates no second campaign when the commit misses', async () => {
    const outreachId = await createDraft()
    const errorSpy = loggerErrorSpy()
    // A concurrent actor advances the draft out of `staging` while CallHub is
    // creating, so the commit CAS matches 0 rows — the placed campaign is
    // orphaned (PAUSED, charges nothing).
    createVbSpy.mockImplementationOnce(async () => {
      await service.prisma.outreachRobocall.updateMany({
        where: { outreachId },
        data: {
          settleState: RobocallSettleState.authorized,
          callhubCampaignPkStr: 'vb_concurrent',
        },
      })
      return vbResult('vb_1')
    })

    await staging.stageCampaign(outreachId)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ orphanedCampaignPkStr: 'vb_1' }),
      expect.any(String),
    )
    // A later pass creates no second campaign (pk_str is set → not eligible).
    await staging.stageCampaign(outreachId)
    expect(createVbSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).callhubCampaignPkStr).toBe(
      'vb_concurrent',
    )
  })

  it('reclaims a stale staging row and stages it', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.staging,
    })
    await ageStagingRow(outreachId, 45)

    await staging.stageCampaign(outreachId)

    expect(createVbSpy).toHaveBeenCalledTimes(1)
    const satellite = await readSatellite(outreachId)
    expect(satellite.callhubCampaignPkStr).toBe('vb_1')
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
  })

  it('does not reclaim a fresh (in-flight) staging row', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.staging,
    })

    await staging.stageCampaign(outreachId)

    // updatedAt is recent, so the stale-reclaim predicate misses — a healthy
    // in-flight run is never double-driven into a second campaign.
    expect(createVbSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.staging)
    expect(satellite.callhubCampaignPkStr).toBeNull()
  })
})

describe('OutreachRobocallStagingService.sweepRobocallStaging (prod)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('stages only in-window drafts, once across repeat sweeps', async () => {
    const inWindow = await createDraft({ sendInHours: 1 })
    const outOfWindow = await createDraft({ sendInHours: 5 })

    await staging.sweepRobocallStaging()
    // A second sweep in the same slot must not re-stage: the eligibility filter
    // excludes the now-staged draft (pk_str set), so no second CallHub create.
    await staging.sweepRobocallStaging()

    expect(createVbSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(inWindow)).callhubCampaignPkStr).toBe('vb_1')
    expect((await readSatellite(outOfWindow)).callhubCampaignPkStr).toBeNull()
  })

  it('reclaims a stranded stale staging row in-window', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.staging,
    })
    await ageStagingRow(outreachId, 45)

    await staging.sweepRobocallStaging()

    expect(createVbSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).callhubCampaignPkStr).toBe('vb_1')
  })

  it('continues past a failing draft and stages the rest', async () => {
    const a = await createDraft({ sendInHours: 1 })
    const b = await createDraft({ sendInHours: 1 })
    createVbSpy
      .mockRejectedValueOnce(new BadGatewayException('boom'))
      .mockResolvedValue(vbResult('vb_ok'))

    await staging.sweepRobocallStaging()

    // Order-independent: exactly one draft fails (reverted, unstaged) and the
    // other stages, regardless of findMany return order.
    const rows = [await readSatellite(a), await readSatellite(b)]
    const staged = rows.filter((r) => r.callhubCampaignPkStr !== null)
    const unstaged = rows.filter((r) => r.callhubCampaignPkStr === null)
    expect(staged).toHaveLength(1)
    expect(staged[0]?.callhubCampaignPkStr).toBe('vb_ok')
    expect(unstaged).toHaveLength(1)
    expect(unstaged[0]?.settleState).toBe(RobocallSettleState.authorized)
  })
})

describe('OutreachRobocallStagingService.sweepRobocallStaging guard', () => {
  it('no-ops off prod', async () => {
    const original = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    try {
      const outreachId = await createDraft({ sendInHours: 1 })

      await staging.sweepRobocallStaging()

      expect(createVbSpy).not.toHaveBeenCalled()
      expect((await readSatellite(outreachId)).callhubCampaignPkStr).toBeNull()
    } finally {
      if (original === undefined) {
        delete process.env.OTEL_SERVICE_ENVIRONMENT
      } else {
        process.env.OTEL_SERVICE_ENVIRONMENT = original
      }
    }
  })
})
