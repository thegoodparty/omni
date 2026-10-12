import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  User,
} from '../../generated/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { AreaCodeFromZipService } from 'src/ai/util/areaCodeFromZip.util'
import { CampaignTcrComplianceService } from 'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { PrismaService } from 'src/prisma/prisma.service'
import { GooglePlacesService } from 'src/vendors/google/services/google-places.service'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import type {
  CampaignGeographyInput,
  ResolveP2pJobGeographyServices,
} from '../util/campaignGeography.util'
import type { CreateOutreachSchema } from '../schemas/createOutreachSchema'
import { EmailService } from 'src/email/email.service'
import { OutreachMaterializationService } from './outreachMaterialization.service'
import { OutreachNotificationService } from './outreachNotification.service'
import { OutreachRobocallCancelService } from './outreachRobocallCancel.service'
import { OutreachP2pSmsCancelService } from './outreachP2pSmsCancel.service'
import { OutreachService } from './outreach.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'

const mockOutreachCreate = vi.fn()
const mockOutreachFindMany = vi.fn()
const mockOutreachUpdateMany = vi.fn()
const mockOutreachFindFirst = vi.fn()
const mockOutreachUpdate = vi.fn()
const mockOutreachFindUniqueOrThrow = vi.fn()
const mockGetFileBytes = vi.fn()

const mockTcrFindFirstOrThrow = vi.fn()
const mockTcrFindFirst = vi.fn()
const mockPeerlyCreateJob = vi.fn()
const mockResolveP2pJobGeography = vi.fn()
const mockNotifySuccess = vi.fn()
const mockNotifyFailure = vi.fn()
const mockSendEmail = vi.fn()
const mockFindVoterFileFilter = vi.fn()
const mockFilterAccessCheck = vi.fn()
const mockMaterializeOutreach = vi.fn()
const mockAnalyticsTrack = vi.fn()

vi.mock('../util/campaignGeography.util', () => ({
  resolveP2pJobGeography: (
    campaign: CampaignGeographyInput,
    services: ResolveP2pJobGeographyServices,
  ) => mockResolveP2pJobGeography(campaign, services),
}))

describe('OutreachService', () => {
  let service: OutreachService

  const mockUser = {
    id: 100,
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
  } as User

  const mockCampaign = {
    id: 1,
    // Deliberately NOT mockUser.id: the send terminal keys on the campaign's
    // userId COLUMN, not the loaded `user` relation, so the two must differ
    // for that to be pinned — with both at 100 an implementation reading
    // `campaign.user?.id` passes, and in the no-user case both are undefined.
    userId: 55,
    slug: 'jane-doe',
    organizationSlug: 'org-test',
    aiContent: {},
    data: { hubspotId: 'hub-1' },
    details: null,
  } as unknown as Campaign

  const baseCreateDto: CreateOutreachSchema = {
    campaignId: 1,
    outreachType: OutreachType.text,
    status: OutreachStatus.pending,
    date: '2025-02-01T12:00:00.000Z',
  }

  const p2pCreateDto: CreateOutreachSchema = {
    ...baseCreateDto,
    outreachType: OutreachType.p2p,
    // p2p create enforces the CAS compliance list on the resolved script, so
    // a p2p DTO here has to carry a message that actually passes it.
    script:
      'Hello {first_name}, this is Jane Doe. Vote for me. ' +
      'Paid for by Friends of Jane. Reply STOP to opt out.',
    phoneListId: 100,
    title: 'P2P Title',
    draft: true,
  }

  beforeEach(async () => {
    mockOutreachCreate.mockReset()
    mockOutreachFindMany.mockReset()
    mockOutreachUpdateMany.mockReset()
    mockOutreachFindFirst.mockReset()
    mockOutreachUpdate.mockReset()
    mockOutreachFindUniqueOrThrow.mockReset()
    mockGetFileBytes.mockReset()
    mockTcrFindFirstOrThrow.mockReset()
    mockTcrFindFirst.mockReset()
    mockTcrFindFirst.mockResolvedValue({
      candidateName: 'Jane Doe',
      committeeName: 'Friends of Jane',
    })
    mockPeerlyCreateJob.mockReset()
    mockResolveP2pJobGeography.mockReset()
    mockNotifySuccess.mockReset()
    mockNotifySuccess.mockResolvedValue(undefined)
    mockNotifyFailure.mockReset()
    mockNotifyFailure.mockResolvedValue(undefined)
    mockSendEmail.mockReset()
    mockSendEmail.mockResolvedValue(undefined)
    mockFindVoterFileFilter.mockReset()
    mockFilterAccessCheck.mockReset()
    mockFilterAccessCheck.mockResolvedValue(undefined)
    mockAnalyticsTrack.mockReset()
    mockAnalyticsTrack.mockResolvedValue(undefined)
    mockMaterializeOutreach.mockReset()
    mockMaterializeOutreach.mockResolvedValue(undefined)

    const mockPrismaService = {
      outreach: {
        create: mockOutreachCreate,
        findMany: mockOutreachFindMany,
        findFirst: mockOutreachFindFirst,
        findFirstOrThrow: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: mockOutreachFindUniqueOrThrow,
        count: vi.fn(),
        updateMany: mockOutreachUpdateMany,
        update: mockOutreachUpdate,
      },
      // requireCompliantScript reads the campaign owner's name as one of the
      // candidate-name candidates; the TCR record above supplies the other.
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      // cancelOutreach probes for a hold-model satellite before the shared body;
      // no satellite here, so these tests stay on the immediate-charge path.
      outreachP2pSms: { findUnique: vi.fn().mockResolvedValue(null) },
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: GooglePlacesService, useValue: {} },
        { provide: AreaCodeFromZipService, useValue: {} },
        {
          provide: CampaignTcrComplianceService,
          useValue: {
            findFirstOrThrow: mockTcrFindFirstOrThrow,
            findFirst: mockTcrFindFirst,
          },
        },
        {
          provide: PeerlyP2pJobService,
          useValue: {
            createPeerlyP2pJob: mockPeerlyCreateJob,
          },
        },
        {
          provide: OutreachNotificationService,
          useValue: {
            notifySuccess: mockNotifySuccess,
            notifyFailure: mockNotifyFailure,
          },
        },
        {
          provide: EmailService,
          useValue: { sendEmail: mockSendEmail },
        },
        {
          provide: VoterFileFilterService,
          useValue: {
            findByIdAndOrganizationSlug: mockFindVoterFileFilter,
            filterAccessCheck: mockFilterAccessCheck,
          },
        },
        {
          provide: OutreachMaterializationService,
          useValue: {
            materializeOutreach: mockMaterializeOutreach,
          },
        },
        {
          provide: S3Service,
          useValue: { getFileBytesWithContentType: mockGetFileBytes },
        },
        {
          provide: StripeService,
          useValue: {},
        },
        {
          provide: AnalyticsService,
          useValue: { track: mockAnalyticsTrack },
        },
        {
          provide: OutreachRobocallCancelService,
          useValue: { cancel: vi.fn() },
        },
        {
          provide: OutreachP2pSmsCancelService,
          useValue: { cancel: vi.fn() },
        },
        OutreachService,
      ],
    }).compile()

    await module.init()
    service = module.get(OutreachService)

    Object.defineProperty(service, 'logger', {
      get: () => createMockLogger(),
      configurable: true,
    })
  })

  describe('create', () => {
    it('creates non-P2P outreach via createRecord', async () => {
      const imageUrl = 'https://cdn.example.com/image.png'
      const created = {
        id: 1,
        ...baseCreateDto,
        imageUrl,
        voterFileFilter: null,
      }
      mockOutreachCreate.mockResolvedValue(created)

      const result = await service.create(
        mockUser,
        mockCampaign,
        baseCreateDto,
        imageUrl,
      )

      expect(mockOutreachCreate).toHaveBeenCalledTimes(1)
      expect(mockOutreachCreate).toHaveBeenCalledWith({
        data: {
          ...baseCreateDto,
          organizationSlug: mockCampaign.organizationSlug,
          imageUrl,
        },
        include: { voterFileFilter: true },
      })
      expect(result).toEqual(created)
    })

    it('hands the created outreach to list materialization', async () => {
      const created = { id: 9, ...baseCreateDto, voterFileFilter: null }
      mockOutreachCreate.mockResolvedValue(created)

      await service.create(mockUser, mockCampaign, baseCreateDto, undefined)

      expect(mockMaterializeOutreach).toHaveBeenCalledWith(
        mockCampaign,
        created,
      )
    })

    it('still returns the outreach when materialization throws', async () => {
      const created = { id: 10, ...baseCreateDto, voterFileFilter: null }
      mockOutreachCreate.mockResolvedValue(created)
      mockMaterializeOutreach.mockRejectedValue(new Error('people api down'))

      const result = await service.create(
        mockUser,
        mockCampaign,
        baseCreateDto,
        undefined,
      )

      expect(result).toEqual(created)
    })

    it('hands the finalized outreach to list materialization on purchase finalize', async () => {
      const draft = {
        id: 42,
        campaignId: 1,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        imageUrl: 'https://assets.goodparty.org/outreach/img.png',
        phoneListId: 100,
        script: 'hello voter',
        identityId: 'ident-1',
        title: 'P2P Title',
        name: null,
        didState: null,
        didNpaSubset: null,
        date: new Date('2025-02-01T12:00:00.000Z'),
        audienceRequest: null,
        campaignPlanDueDate: null,
        textCount: null,
        billableTextCount: null,
        voterFileFilterId: 7,
        voterFileFilter: null,
        campaign: { ...mockCampaign, user: mockUser },
      }
      mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
      mockOutreachFindUniqueOrThrow.mockResolvedValue(draft)
      mockGetFileBytes.mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      mockPeerlyCreateJob.mockResolvedValue('job-123')
      mockOutreachUpdate.mockResolvedValue({})

      await service.finalizeOutreachPurchase(42, 1)

      expect(mockMaterializeOutreach).toHaveBeenCalledWith(
        draft.campaign,
        expect.objectContaining({ id: 42, projectId: 'job-123' }),
      )
    })

    it('defers finalize (no claim, no Peerly submit) for a linked pre-build p2p draft under the hold flag', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      try {
        // A paid draft (satellite linked to its building list) whose build has
        // not finished: no numeric phoneListId yet. The build-ready edge
        // finalizes it later instead.
        mockOutreachFindFirst.mockResolvedValue({
          phoneListId: null,
          outreachType: OutreachType.p2p,
          p2pSms: { peerlyPhoneListId: 'ppl-uuid-1' },
        })

        const finalized = await service.finalizeOutreachPurchase(99, 1)

        // The defer returns false before claiming (pending_payment -> pending)
        // and before any Peerly submission, so the draft is never transitioned.
        expect(finalized).toBe(false)
        expect(mockOutreachUpdateMany).not.toHaveBeenCalled()
        expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
        expect(mockMaterializeOutreach).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('does NOT defer a pre-build p2p draft with no satellite link (the hold-less free path)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      try {
        // phoneListId null but NO satellite link: the build-ready edge finds
        // work through the link, so a link-less draft must not defer (it would
        // strand forever). It proceeds to the claim instead.
        mockOutreachFindFirst.mockResolvedValueOnce({
          phoneListId: null,
          outreachType: OutreachType.p2p,
          p2pSms: null,
        })
        // Claim lost, then observed already-finalized, so finalize returns
        // without the slow in-flight poll — enough to prove it did NOT defer.
        mockOutreachUpdateMany.mockResolvedValue({ count: 0 })
        mockOutreachFindFirst.mockResolvedValue({ projectId: 'job-x' })

        const finalized = await service.finalizeOutreachPurchase(55, 1)

        expect(finalized).toBe(false)
        // It attempted the claim (did not defer).
        expect(mockOutreachUpdateMany).toHaveBeenCalled()
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('finalizes as usual under the flag once the build is ready (phoneListId present)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
      try {
        const draft = {
          id: 77,
          campaignId: 1,
          outreachType: OutreachType.p2p,
          status: OutreachStatus.pending,
          imageUrl: 'https://assets.goodparty.org/outreach/img.png',
          phoneListId: 100,
          script: 'hello voter',
          identityId: 'ident-1',
          title: 'P2P Title',
          name: null,
          didState: null,
          didNpaSubset: null,
          date: new Date('2025-02-01T12:00:00.000Z'),
          audienceRequest: null,
          campaignPlanDueDate: null,
          textCount: null,
          billableTextCount: null,
          voterFileFilterId: 7,
          voterFileFilter: null,
          campaign: { ...mockCampaign, user: mockUser },
        }
        // The defer peek sees a stamped phoneListId, so finalize proceeds.
        mockOutreachFindFirst.mockResolvedValue({
          phoneListId: 100,
          outreachType: OutreachType.p2p,
        })
        mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
        mockOutreachFindUniqueOrThrow.mockResolvedValue(draft)
        mockGetFileBytes.mockResolvedValue({
          bytes: Buffer.from('img'),
          contentType: 'image/png',
        })
        mockPeerlyCreateJob.mockResolvedValue('job-770')
        mockOutreachUpdate.mockResolvedValue({})

        await service.finalizeOutreachPurchase(77, 1)

        expect(mockPeerlyCreateJob).toHaveBeenCalled()
        expect(mockMaterializeOutreach).toHaveBeenCalledWith(
          draft.campaign,
          expect.objectContaining({ id: 77, projectId: 'job-770' }),
        )
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('materializes on finalize even when the campaign has no user', async () => {
      const draft = {
        id: 43,
        campaignId: 1,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        imageUrl: 'https://assets.goodparty.org/outreach/img.png',
        phoneListId: 100,
        script: 'hello voter',
        identityId: 'ident-1',
        title: 'P2P Title',
        name: null,
        didState: null,
        didNpaSubset: null,
        date: new Date('2025-02-01T12:00:00.000Z'),
        audienceRequest: null,
        campaignPlanDueDate: null,
        textCount: null,
        billableTextCount: null,
        voterFileFilterId: 7,
        voterFileFilter: null,
        campaign: { ...mockCampaign, user: null },
      }
      mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
      mockOutreachFindUniqueOrThrow.mockResolvedValue(draft)
      mockGetFileBytes.mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      mockPeerlyCreateJob.mockResolvedValue('job-456')
      mockOutreachUpdate.mockResolvedValue({})

      await service.finalizeOutreachPurchase(43, 1)

      expect(mockMaterializeOutreach).toHaveBeenCalledWith(
        draft.campaign,
        expect.objectContaining({ id: 43, projectId: 'job-456' }),
      )
      expect(mockNotifySuccess).not.toHaveBeenCalled()
      // The OKR signal is keyed on campaign.userId, not the absent `user`
      // relation, so a missing user record drops the notifications above but
      // NOT the send terminal (DATA-2526).
      expect(mockAnalyticsTrack).toHaveBeenCalledWith(
        mockCampaign.userId,
        EVENTS.Outreach.CampaignScheduled,
        expect.objectContaining({ channel: 'sms', outreachId: 43 }),
        undefined,
        '43:campaign_scheduled',
      )
    })

    it('emits the send terminal once on finalize, with the recipient count', async () => {
      const draft = {
        id: 44,
        campaignId: 1,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        imageUrl: 'https://assets.goodparty.org/outreach/img.png',
        phoneListId: 100,
        script: 'hello voter',
        identityId: 'ident-1',
        title: 'P2P Title',
        name: null,
        didState: null,
        didNpaSubset: null,
        date: new Date('2025-02-01T12:00:00.000Z'),
        audienceRequest: null,
        campaignPlanDueDate: null,
        textCount: 250,
        billableTextCount: 250,
        voterFileFilterId: 7,
        voterFileFilter: null,
        campaign: { ...mockCampaign, user: mockUser },
      }
      mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
      mockOutreachFindUniqueOrThrow.mockResolvedValue(draft)
      mockGetFileBytes.mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      mockPeerlyCreateJob.mockResolvedValue('job-789')
      mockOutreachUpdate.mockResolvedValue({})

      await service.finalizeOutreachPurchase(44, 1)

      const scheduled = mockAnalyticsTrack.mock.calls.filter(
        (call) => call[1] === EVENTS.Outreach.CampaignScheduled,
      )
      expect(scheduled).toHaveLength(1)
      expect(firstOrThrow(scheduled)).toEqual([
        mockCampaign.userId,
        EVENTS.Outreach.CampaignScheduled,
        { channel: 'sms', medium: 'text', outreachId: 44, recipientCount: 250 },
        undefined,
        // Deterministic messageId: a Segment replay dedups to one event.
        '44:campaign_scheduled',
      ])
    })

    it('does not emit the send terminal when the purchase claim finds nothing', async () => {
      // The replay path: a Stripe webhook retry loses the pending_payment ->
      // pending race, so finalize returns at the claim. This is what makes the
      // emit exactly-once without its own dedup.
      // findFirst resolves undefined here, so the watch reports `missing` on
      // its first pass rather than sleeping, and the claim throws to send the
      // webhook back for a retry. Either way the claim was lost, so nothing
      // is emitted.
      mockOutreachUpdateMany.mockResolvedValue({ count: 0 })

      await expect(service.finalizeOutreachPurchase(45, 1)).rejects.toThrow()

      expect(mockAnalyticsTrack).not.toHaveBeenCalled()
    })

    // The race behind incident 94: the browser's own complete-checkout-session
    // call and the Stripe webhook arrive in the same second, the browser wins
    // the claim, Peerly refuses the candidate's script, and the browser hands
    // the draft back. What the webhook does with that hand-back decides
    // whether Stripe is told to redeliver.
    describe('when the finalize claim is lost', () => {
      const heldDraft = {
        id: 46,
        campaignId: 1,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
        imageUrl: 'https://assets.goodparty.org/outreach/img.png',
        phoneListId: 100,
        script: 'hello voter https://bit.ly/abc',
        identityId: 'ident-1',
        title: 'P2P Title',
        name: null,
        didState: null,
        didNpaSubset: null,
        date: new Date('2025-02-01T12:00:00.000Z'),
        audienceRequest: null,
        campaignPlanDueDate: null,
        textCount: 250,
        billableTextCount: 250,
        voterFileFilterId: 7,
        voterFileFilter: null,
        campaign: { ...mockCampaign, user: mockUser },
      }

      it('does nothing further once a concurrent finalize stamped a job', async () => {
        mockOutreachUpdateMany.mockResolvedValue({ count: 0 })
        mockOutreachFindFirst.mockResolvedValue({
          status: OutreachStatus.pending,
          projectId: 'job-123',
        })

        // A lost claim (a concurrent finalize already stamped the job) returns
        // false — not finalized by THIS caller.
        await expect(service.finalizeOutreachPurchase(46, 1)).resolves.toBe(
          false,
        )

        expect(mockOutreachFindUniqueOrThrow).not.toHaveBeenCalled()
        expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
      })

      it('takes over a draft the winner handed back and raises the real refusal', async () => {
        // First claim loses, the watch sees pending_payment, the retake wins.
        mockOutreachUpdateMany
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValue({ count: 1 })
        mockOutreachFindFirst.mockResolvedValue({
          status: OutreachStatus.pending_payment,
          projectId: null,
        })
        mockOutreachFindUniqueOrThrow.mockResolvedValue(heldDraft)
        mockGetFileBytes.mockResolvedValue({
          bytes: Buffer.from('img'),
          contentType: 'image/png',
        })
        mockPeerlyCreateJob.mockRejectedValue(
          new BadRequestException('Message cannot contain bit.ly links.'),
        )

        // A content refusal, not a bare retryable failure: the webhook layer
        // reads BadRequestException as permanent and acknowledges Stripe
        // instead of collecting redeliveries.
        await expect(service.finalizeOutreachPurchase(46, 1)).rejects.toThrow(
          BadRequestException,
        )
        expect(mockPeerlyCreateJob).toHaveBeenCalledTimes(1)
        // The revert must fire: pending -> pending_payment hands the draft
        // back so the candidate can edit and schedule again. Call 1 = the
        // claim we lost, call 2 = the takeover claim we won, call 3 = the
        // revert. Without the third the draft would be stranded at pending
        // with no Peerly job and nothing able to claim it.
        expect(mockOutreachUpdateMany).toHaveBeenCalledTimes(3)
        expect(mockOutreachUpdateMany).toHaveBeenNthCalledWith(3, {
          where: {
            id: 46,
            status: OutreachStatus.pending,
            projectId: null,
          },
          data: { status: OutreachStatus.pending_payment },
        })
      })

      it('takes the draft over once, then defers to a redelivery', async () => {
        mockOutreachUpdateMany.mockResolvedValue({ count: 0 })
        mockOutreachFindFirst.mockResolvedValue({
          status: OutreachStatus.pending_payment,
          projectId: null,
        })

        await expect(service.finalizeOutreachPurchase(46, 1)).rejects.toThrow(
          /a concurrent finalize failed and the retake lost the claim too/,
        )
        expect(mockOutreachUpdateMany).toHaveBeenCalledTimes(2)
        expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
      })
    })

    it('forwards campaignPlanDueDate from the DTO into notifySuccess', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        campaignPlanDueDate: '2026-04-19',
      }
      mockOutreachCreate.mockResolvedValue({
        id: 1,
        ...dto,
        voterFileFilter: null,
      })

      await service.create(mockUser, mockCampaign, dto, undefined)

      expect(mockNotifySuccess).toHaveBeenCalledWith(
        expect.objectContaining({ campaignPlanDueDate: '2026-04-19' }),
      )
    })

    it('persists campaignPlanDueDate on the outreach row', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        campaignPlanDueDate: '2026-04-19',
      }
      mockOutreachCreate.mockResolvedValue({
        id: 1,
        ...dto,
        voterFileFilter: null,
      })

      await service.create(mockUser, mockCampaign, dto, undefined)

      const [createArg] = firstOrThrow(mockOutreachCreate.mock.calls)
      expect(createArg.data).toHaveProperty('campaignPlanDueDate', '2026-04-19')
    })

    it('forwards text counts into notifySuccess and persists them', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        textCount: 5200,
        billableTextCount: 200,
      }
      mockOutreachCreate.mockResolvedValue({
        id: 1,
        ...dto,
        voterFileFilter: null,
      })

      await service.create(mockUser, mockCampaign, dto, undefined)

      expect(mockNotifySuccess).toHaveBeenCalledWith(
        expect.objectContaining({ textCount: 5200, billableTextCount: 200 }),
      )
      const [createArg] = firstOrThrow(mockOutreachCreate.mock.calls)
      expect(createArg.data).toMatchObject({
        textCount: 5200,
        billableTextCount: 200,
      })
    })

    it('creates non-P2P outreach without imageUrl when both omitted', async () => {
      const created = { id: 1, ...baseCreateDto, voterFileFilter: null }
      mockOutreachCreate.mockResolvedValue(created)

      await service.create(mockUser, mockCampaign, baseCreateDto, undefined)

      expect(mockOutreachCreate).toHaveBeenCalledWith({
        data: {
          ...baseCreateDto,
          organizationSlug: mockCampaign.organizationSlug,
        },
        include: { voterFileFilter: true },
      })
    })

    it('writes a P2P create as an unpaid draft and calls no vendor', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({
        peerlyIdentityId: 'identity-123',
      })
      mockResolveP2pJobGeography.mockResolvedValue({
        didState: 'CA',
        didNpaSubset: ['415', '510'],
      })
      const created = {
        id: 2,
        ...p2pCreateDto,
        status: OutreachStatus.pending_payment,
        didState: 'CA',
        didNpaSubset: ['415', '510'],
        imageUrl: 'https://cdn.example.com/p2p.png',
        voterFileFilter: null,
      }
      mockOutreachCreate.mockResolvedValue(created)

      const result = await service.create(
        mockUser,
        mockCampaign,
        p2pCreateDto,
        'https://cdn.example.com/p2p.png',
      )

      expect(mockTcrFindFirstOrThrow).toHaveBeenCalledWith({
        where: { campaignId: mockCampaign.id },
      })
      expect(mockResolveP2pJobGeography).toHaveBeenCalledWith(
        mockCampaign,
        expect.objectContaining({
          placesService: expect.anything(),
          areaCodeFromZipService: expect.anything(),
        }),
      )
      expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
      expect(mockOutreachCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: p2pCreateDto.campaignId,
          outreachType: OutreachType.p2p,
          phoneListId: p2pCreateDto.phoneListId,
          organizationSlug: mockCampaign.organizationSlug,
          status: OutreachStatus.pending_payment,
          identityId: 'identity-123',
          didState: 'CA',
          didNpaSubset: ['415', '510'],
          imageUrl: 'https://cdn.example.com/p2p.png',
        }),
        include: { voterFileFilter: true },
      })
      // `draft` selects the write path; it is not a column.
      const [{ data }] = firstOrThrow(mockOutreachCreate.mock.calls)
      expect(data).not.toHaveProperty('draft')
      // Notification and materialization belong to the funded send, which
      // finalizeOutreachPurchase performs — not to writing the draft.
      expect(mockNotifySuccess).not.toHaveBeenCalled()
      expect(mockMaterializeOutreach).not.toHaveBeenCalled()
      expect(result).toEqual(created)
    })

    describe('Win SMS hold pay-before-build (WIN_SMS_HOLD_BILLING)', () => {
      afterEach(() => {
        vi.unstubAllEnvs()
      })

      it('flag ON: writes a P2P draft with no phoneListId (the list is still building)', async () => {
        vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
        mockTcrFindFirstOrThrow.mockResolvedValue({
          peerlyIdentityId: 'identity-123',
        })
        mockResolveP2pJobGeography.mockResolvedValue({
          didState: 'CA',
          didNpaSubset: ['415'],
        })
        mockOutreachCreate.mockResolvedValue({ id: 3, voterFileFilter: null })

        const { phoneListId: _omit, ...preBuildDto } = p2pCreateDto

        await service.create(
          mockUser,
          mockCampaign,
          preBuildDto,
          'https://cdn.example.com/p2p.png',
        )

        expect(mockOutreachCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              outreachType: OutreachType.p2p,
              status: OutreachStatus.pending_payment,
            }),
          }),
        )
      })

      it('flag OFF: still requires phoneListId for a P2P create', async () => {
        const { phoneListId: _omit, ...preBuildDto } = p2pCreateDto

        await expect(
          service.create(
            mockUser,
            mockCampaign,
            preBuildDto,
            'https://cdn.example.com/p2p.png',
          ),
        ).rejects.toThrow('Phone list ID is required for P2P outreach')
      })
    })

    it('blocks a P2P send with a testing-specific message for an internal-testing approval', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({
        peerlyIdentityId: null,
        internalTestingAt: new Date(),
      })

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
        ),
      ).rejects.toThrow(
        'Campaign is 10DLC-approved for internal testing only; ' +
          'real P2P sends are disabled',
      )
      expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
    })

    it('blocks a P2P send with the generic message when no Peerly identity exists', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({
        peerlyIdentityId: null,
        internalTestingAt: null,
      })

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
        ),
      ).rejects.toThrow(
        'TCR Compliance Peerly identity ID is required for P2P outreach',
      )
      expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
    })

    it('throws BadRequest when the resolved P2P script exceeds the MMS limit', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({
        peerlyIdentityId: 'identity-123',
      })
      // The DTO script is a short aiContent key; the oversized text only
      // appears after resolution, so schema validation alone can't catch it.
      const campaignWithLongScript = {
        ...mockCampaign,
        aiContent: {
          smsKey: { content: 'x'.repeat(P2P_SCRIPT_MAX_LENGTH + 1) },
        },
      } as unknown as Campaign

      await expect(
        service.create(
          mockUser,
          campaignWithLongScript,
          { ...p2pCreateDto, script: 'smsKey' },
          'https://cdn.example.com/p2p.png',
        ),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('throws BadRequest when P2P flow has no peerlyIdentityId', async () => {
      mockTcrFindFirstOrThrow.mockResolvedValue({ peerlyIdentityId: null })

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
        ),
      ).rejects.toThrow(BadRequestException)

      expect(mockPeerlyCreateJob).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('throws BadRequest when P2P is requested without imageUrl', async () => {
      await expect(
        service.create(mockUser, mockCampaign, p2pCreateDto, undefined),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create(mockUser, mockCampaign, p2pCreateDto, undefined),
      ).rejects.toThrow(/required for P2P outreach/)

      expect(mockTcrFindFirstOrThrow).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('succeeds when voterFileFilterId belongs to the campaign org', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        voterFileFilterId: 42,
      }
      mockFindVoterFileFilter.mockResolvedValue({
        id: 42,
        organizationSlug: 'org-test',
      })
      const created = {
        id: 1,
        ...dto,
        voterFileFilter: { id: 42 },
      }
      mockOutreachCreate.mockResolvedValue(created)

      const result = await service.create(
        mockUser,
        mockCampaign,
        dto,
        undefined,
      )

      expect(mockFindVoterFileFilter).toHaveBeenCalledWith(42, 'org-test')
      expect(mockFilterAccessCheck).toHaveBeenCalledWith('org-test')
      expect(mockOutreachCreate).toHaveBeenCalledTimes(1)
      expect(result).toEqual(created)
    })

    it('throws NotFoundException when voterFileFilterId does not belong to the campaign org', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        voterFileFilterId: 99,
      }
      mockFindVoterFileFilter.mockResolvedValue(null)

      await expect(
        service.create(mockUser, mockCampaign, dto, undefined),
      ).rejects.toThrow(NotFoundException)
      await expect(
        service.create(mockUser, mockCampaign, dto, undefined),
      ).rejects.toThrow(/Voter file filter not found/)

      expect(mockFilterAccessCheck).toHaveBeenCalledWith('org-test')
      expect(mockFindVoterFileFilter).toHaveBeenCalledWith(99, 'org-test')
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('throws Forbidden when filterAccessCheck rejects a non-pro campaign', async () => {
      const dto: CreateOutreachSchema = {
        ...baseCreateDto,
        voterFileFilterId: 42,
      }
      mockFilterAccessCheck.mockRejectedValue(
        new ForbiddenException('Campaign is not pro'),
      )

      await expect(
        service.create(mockUser, mockCampaign, dto, undefined),
      ).rejects.toThrow(ForbiddenException)
      await expect(
        service.create(mockUser, mockCampaign, dto, undefined),
      ).rejects.toThrow(/Campaign is not pro/)

      expect(mockFindVoterFileFilter).not.toHaveBeenCalled()
      expect(mockOutreachCreate).not.toHaveBeenCalled()
    })

    it('tags TCR lookup failures as OutreachStepError(tcrLookup)', async () => {
      mockTcrFindFirstOrThrow.mockRejectedValue(new Error('TCR not found'))

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
        ),
      ).rejects.toThrow(BadGatewayException)

      await expect(
        service.create(
          mockUser,
          mockCampaign,
          p2pCreateDto,
          'https://cdn.example.com/p2p.png',
        ),
      ).rejects.toThrow(/step "tcrLookup"/)
    })
  })

  describe('failOutreachPurchase', () => {
    const unpaidDraft = {
      id: 42,
      campaignId: 1,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.failed,
      script: 'hello voter',
      date: new Date('2026-09-16T17:00:00.000Z'),
      campaign: { ...mockCampaign, user: mockUser },
    }

    it('marks the unpaid draft failed and tells CAS and the candidate', async () => {
      mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
      mockOutreachFindUniqueOrThrow.mockResolvedValue(unpaidDraft)

      await service.failOutreachPurchase(42, 1, 'cs_failed')

      expect(mockOutreachUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 42,
          campaignId: 1,
          status: OutreachStatus.pending_payment,
          projectId: null,
        },
        data: { status: OutreachStatus.failed },
      })
      expect(mockNotifyFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          user: mockUser,
          campaign: unpaidDraft.campaign,
          step: 'payment',
        }),
      )
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockUser.email,
          message: expect.stringContaining('September 16, 2026'),
        }),
      )
    })

    it('does nothing when the draft was already finalized or failed', async () => {
      mockOutreachUpdateMany.mockResolvedValue({ count: 0 })

      await service.failOutreachPurchase(42, 1, 'cs_failed')

      expect(mockOutreachFindUniqueOrThrow).not.toHaveBeenCalled()
      expect(mockNotifyFailure).not.toHaveBeenCalled()
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('still emails the candidate when the CAS post fails', async () => {
      mockOutreachUpdateMany.mockResolvedValue({ count: 1 })
      mockOutreachFindUniqueOrThrow.mockResolvedValue(unpaidDraft)
      mockNotifyFailure.mockRejectedValue(new Error('slack down'))

      await expect(
        service.failOutreachPurchase(42, 1, 'cs_failed'),
      ).resolves.toBeUndefined()
      expect(mockSendEmail).toHaveBeenCalled()
    })
  })

  describe('findByCampaignId', () => {
    it('returns outreach list when campaign has outreaches', async () => {
      const list = [
        { id: 1, campaignId: 1, voterFileFilter: null },
        { id: 2, campaignId: 1, voterFileFilter: null },
      ]
      mockOutreachFindMany.mockResolvedValue(list)

      const result = await service.findByCampaignId(1)

      expect(mockOutreachFindMany).toHaveBeenCalledWith({
        where: {
          campaignId: 1,
          OR: [
            { status: { not: OutreachStatus.pending_payment } },
            { status: null },
          ],
        },
        include: { voterFileFilter: true },
      })
      // `findByScope` collapses door-knocking siblings into their anchor and
      // attaches a `turfCount`; a non-door-knocking row passes through as its
      // own campaign of one. See `collapseDoorKnockingCampaigns`.
      expect(result).toEqual(list.map((row) => ({ ...row, turfCount: 1 })))
    })

    it('throws NotFoundException when no outreaches exist for campaign', async () => {
      mockOutreachFindMany.mockResolvedValue([])

      await expect(service.findByCampaignId(999)).rejects.toThrow(
        NotFoundException,
      )
      await expect(service.findByCampaignId(999)).rejects.toThrow(
        /No outreach campaigns found for campaign ID 999/,
      )
    })
  })
})
