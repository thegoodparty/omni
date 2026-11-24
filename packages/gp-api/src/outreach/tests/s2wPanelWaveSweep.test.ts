import { HttpStatus } from '@nestjs/common'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  OutreachHandoffApiStep,
  OutreachHandoffHandler,
  OutreachStatus,
  OutreachType,
  Prisma,
  VendorMockVendor,
} from '@/generated/prisma'
import {
  disableVendorCrons,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'
import { useTestService } from '@/test-service'
import { VendorMockRecordService } from '@/vendorMocks/vendorMockRecord.service'
import { ScaleToWinApiError } from '@/vendors/scaleToWin/services/scaleToWinHttp.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { SlackService } from '@/vendors/slack/services/slack.service'
import * as handoffMetrics from '../observability/managedPanelHandoff.metrics'
import { S2wPanelWaveSweepService } from '../services/s2wPanelWaveSweep.service'

useAppEnvOverrides({
  IS_NON_PROD_DEPLOY: true,
  VENDOR_MODE: 'mock',
  VENDOR_CRONS_ENABLED: true,
})

const service = useTestService({ jobs: true })

const SEND_AT = new Date('2026-12-01T19:00:00Z')
const MOCK_CAMPAIGNS =
  '/v1/vendor-mocks/scaleToWin/subaccounts/mock-subaccount/campaigns'
const MOCK_AUTH = {
  headers: {
    Authorization: `Basic ${Buffer.from('mock-key-id:mock-key-secret').toString(
      'base64',
    )}`,
  },
}

let slug: string
let slackMessage: Mock<SlackService['message']>
let track: Mock<AnalyticsService['track']>

const sweeper = () => service.app.get(S2wPanelWaveSweepService)

beforeEach(async () => {
  vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
  slug = `eo-s2w-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId: service.user.id },
  })
  slackMessage = vi.fn<SlackService['message']>().mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
  track = vi
    .fn<AnalyticsService['track']>()
    .mockResolvedValue({ event: 'tracked', userId: 'tracked' })
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(track)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const handoff = async (
  data: Partial<Prisma.OutreachTextHandoffUncheckedCreateInput> = {},
) => {
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.pending,
      textCount: 50,
    },
  })
  return service.prisma.outreachTextHandoff.create({
    data: {
      outreachId: outreach.id,
      handler: OutreachHandoffHandler.api,
      apiStep: OutreachHandoffApiStep.pending,
      mode: 'shadow',
      sendAt: SEND_AT,
      timeZone: 'America/Chicago',
      ...data,
    },
  })
}

const reload = (id: string) =>
  service.prisma.outreachTextHandoff.findUniqueOrThrow({ where: { id } })

const erroredEvents = () =>
  track.mock.calls.filter(
    ([, event]) => event === EVENTS.Contacts.CivicPanelWaveErrored,
  )

describe('S2wPanelWaveSweepService.transition', () => {
  it('lets one of two concurrent moves from the same step win', async () => {
    const row = await handoff()

    const results = await Promise.all([
      sweeper().transition(
        row.id,
        OutreachHandoffApiStep.pending,
        OutreachHandoffApiStep.created,
        { apiCampaignId: 'campaign-a' },
      ),
      sweeper().transition(
        row.id,
        OutreachHandoffApiStep.pending,
        OutreachHandoffApiStep.created,
        { apiCampaignId: 'campaign-b' },
      ),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    const after = await reload(row.id)
    expect(after.apiStep).toBe(OutreachHandoffApiStep.created)
    expect(after.apiCampaignId).toBe(results[0] ? 'campaign-a' : 'campaign-b')
  })

  it('never moves a row a person has', async () => {
    const row = await handoff({
      needsHumanAt: new Date(),
      needsHumanReason: 'pending_FORBIDDEN',
    })

    expect(
      await sweeper().transition(
        row.id,
        OutreachHandoffApiStep.pending,
        OutreachHandoffApiStep.created,
      ),
    ).toBe(false)
    expect((await reload(row.id)).apiStep).toBe(OutreachHandoffApiStep.pending)
  })
})

describe('S2wPanelWaveSweepService.stop', () => {
  it('announces a row stopped twice only once', async () => {
    const enrollment = await service.prisma.managedCivicPanel.create({
      data: {
        organizationSlug: slug,
        inviteMessage: 'Join my civic panel.',
        consentVersion: 'v1',
        approvedAt: new Date(),
        goalMembers: 3,
      },
    })
    const wave = await service.prisma.managedPanelWave.create({
      data: { enrollmentId: enrollment.id, wave: 2 },
    })
    const row = await handoff({ apiStep: OutreachHandoffApiStep.loading })
    await service.prisma.outreach.update({
      where: { id: row.outreachId },
      data: { managedPanelWaveId: wave.id },
    })

    const results = await Promise.all([
      sweeper().stop(row, 'count_mismatch', {
        adminUrl: 'https://app.scaletowin.com/campaigns/c-1',
      }),
      sweeper().stop(row, 'count_mismatch'),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    const after = await reload(row.id)
    expect(after.needsHumanAt).not.toBeNull()
    expect(after.needsHumanReason).toBe('count_mismatch')
    expect(after.apiStep).toBe(OutreachHandoffApiStep.loading)

    expect(slackMessage).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(slackMessage.mock.calls[0]?.[0])
    expect(text).toContain(`Outreach: ${row.outreachId}`)
    expect(text).toContain('Wave: 2')
    expect(text).toContain('Step: loading')
    expect(text).toContain('Reason: count_mismatch')

    await vi.waitFor(() => expect(erroredEvents()).toHaveLength(1))
    expect(erroredEvents()[0]?.[2]).toMatchObject({
      organizationSlug: slug,
      wave: 2,
      handoff: 'api',
      step: OutreachHandoffApiStep.loading,
      errorCode: 'count_mismatch',
    })
  })
})

describe('s2wPanelWaveSweep', () => {
  it('stops a row on a client error and moves on to the next', async () => {
    const failing = await handoff()
    const next = await handoff({
      sendAt: new Date('2026-12-02T19:00:00Z'),
    })
    const build = vi
      .spyOn(sweeper(), 'buildCampaign')
      .mockImplementation(async (row) => {
        if (row.id === failing.id) {
          throw new ScaleToWinApiError(
            'Scale to Win copy failed (400 VALIDATION_ERROR)',
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
          )
        }
      })

    await service.jobs.runSchedule('s2wPanelWaveSweep')

    expect(build.mock.calls.map(([row]) => row.id)).toEqual([
      failing.id,
      next.id,
    ])
    const after = await reload(failing.id)
    expect(after.needsHumanReason).toBe('pending_VALIDATION_ERROR')
    expect((await reload(next.id)).needsHumanAt).toBeNull()
    expect(slackMessage).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(erroredEvents()).toHaveLength(1))
    expect(erroredEvents()[0]?.[2]).toMatchObject({
      step: OutreachHandoffApiStep.pending,
      errorCode: 'VALIDATION_ERROR',
    })
  })

  it('fails the run on a throttle and leaves the row to the retry', async () => {
    const row = await handoff()
    vi.spyOn(sweeper(), 'buildCampaign').mockRejectedValue(
      new ScaleToWinApiError(
        'Scale to Win copy failed (429)',
        HttpStatus.TOO_MANY_REQUESTS,
        undefined,
      ),
    )

    const { deadLetters } = await service.jobs.runSchedule(
      's2wPanelWaveSweep',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      expect.objectContaining({ name: 's2wPanelWaveSweep' }),
    ])
    expect((await reload(row.id)).needsHumanAt).toBeNull()
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('only watches a needs-human row and writes nothing to Scale to Win', async () => {
    const copied = await service.client.post(
      `${MOCK_CAMPAIGNS}/7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f/copy`,
      {
        name: 'Panel wave #1',
        contactFields: [],
        scriptVariants: [{ script: 'Hi {{first_name}}' }],
        sendingPhoneNumber: '+16122388359',
      },
      MOCK_AUTH,
    )
    expect(copied.status).toBe(HttpStatus.OK)
    const campaignId: string = copied.data.id
    const records = service.app.get(VendorMockRecordService)
    const before = await records.findOne(
      VendorMockVendor.scale_to_win,
      'campaign',
      campaignId,
    )
    const row = await handoff({
      apiStep: OutreachHandoffApiStep.created,
      apiCampaignId: campaignId,
      needsHumanAt: new Date(),
      needsHumanReason: 'hours_mismatch',
    })
    const watch = vi.spyOn(sweeper(), 'watchNeedsHuman')
    const load = vi.spyOn(sweeper(), 'loadContacts')

    await service.jobs.runSchedule('s2wPanelWaveSweep')

    expect(watch.mock.calls.map(([watched]) => watched.id)).toEqual([row.id])
    expect(load).not.toHaveBeenCalled()
    const after = await records.findOne(
      VendorMockVendor.scale_to_win,
      'campaign',
      campaignId,
    )
    expect(after?.requests).toEqual(before?.requests)
    expect(
      await service.prisma.vendorMockRecord.count({
        where: { vendor: VendorMockVendor.scale_to_win },
      }),
    ).toBe(1)
    expect((await reload(row.id)).apiStep).toBe(OutreachHandoffApiStep.created)
  })

  it('leaves sent, agent and manual rows alone', async () => {
    await handoff({ apiStep: OutreachHandoffApiStep.sent })
    await handoff({ handler: OutreachHandoffHandler.agent, apiStep: null })
    const step = vi.spyOn(sweeper(), 'buildCampaign')
    const watch = vi.spyOn(sweeper(), 'watchNeedsHuman')

    await service.jobs.runSchedule('s2wPanelWaveSweep')

    expect(step).not.toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
  })

  it('reports how many api rows sit at each step', async () => {
    const gauge = vi.spyOn(handoffMetrics, 'recordManagedPanelHandoffApiSteps')
    await handoff()
    await handoff()
    await handoff({ apiStep: OutreachHandoffApiStep.loading })
    await handoff({ handler: OutreachHandoffHandler.agent, apiStep: null })

    await service.jobs.runSchedule('s2wPanelWaveSweep')

    expect(gauge).toHaveBeenCalledWith({
      pending: 2,
      created: 0,
      loading: 1,
      checked: 0,
      starting: 0,
      ready: 0,
      sending: 0,
      sent: 0,
    })
  })

  it('does nothing on a preview stack', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')
    const row = await handoff()
    const step = vi
      .spyOn(sweeper(), 'buildCampaign')
      .mockRejectedValue(
        new ScaleToWinApiError(
          'copy failed',
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
        ),
      )

    await service.jobs.runSchedule('s2wPanelWaveSweep')

    expect(step).not.toHaveBeenCalled()
    expect(await reload(row.id)).toEqual(row)
  })

  it('does nothing on dev put back in live vendor mode', async () => {
    disableVendorCrons()
    await handoff()
    const step = vi.spyOn(sweeper(), 'buildCampaign')

    await service.jobs.runSchedule('s2wPanelWaveSweep')

    expect(step).not.toHaveBeenCalled()
  })
})
