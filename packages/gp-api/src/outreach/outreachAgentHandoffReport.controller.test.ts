import {
  exportJWK,
  generateKeyPair,
  GenerateKeyPairResult,
  SignJWT,
} from 'jose'
import { addDays, addHours, subHours } from 'date-fns'
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { useTestService } from '@/test-service'
import { MANAGED_WAVE_REPLY_DAYS } from '@/managedPanelWaves/managedPanelWaveJob.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  OutreachHandoffStatus,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '../generated/prisma'

const service = useTestService()

const ISSUER = 'https://abc123-def456.tokens.sts.global.api.aws'
const ROLE = 'arn:aws:iam::123456789012:role/delegate-swarm-host'
const KID = 'test-aws-key'
const BASE = '/v1/outreach/agent/handoffs'
const ORG = 'handoff-report-org'
const TOKEN = 'live-claim-token'
const RECIPIENTS = 20

let keys: GenerateKeyPairResult
let jwksBody: string
let panelId: string
let track: Mock<AnalyticsService['track']>
let slackMessage: Mock<SlackService['message']>
const realFetch = globalThis.fetch

const swarm = async () => ({
  headers: {
    Authorization: `Bearer ${await new SignJWT({})
      .setProtectedHeader({ alg: 'ES384', kid: KID, typ: 'JWT' })
      .setIssuer(ISSUER)
      .setAudience('gp-api')
      .setSubject(ROLE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(keys.privateKey)}`,
  },
})

const seed = async (
  handoff: Partial<
    Omit<Prisma.OutreachTextHandoffUncheckedCreateInput, 'outreachId'>
  > = {},
  wave = 1,
) => {
  const managedWave = await service.prisma.managedPanelWave.create({
    data: {
      enrollmentId: panelId,
      wave,
      sentAt: subHours(new Date(), 30),
      steeredToward: 'renters',
      createdAt: subHours(new Date(), 50),
    },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: ORG,
      outreachType: OutreachType.text,
      status: OutreachStatus.in_progress,
      message: 'Join our panel',
      scheduledLocalDate: '2026-11-07',
      textCount: RECIPIENTS,
      managedPanelWaveId: managedWave.id,
    },
  })
  await service.prisma.outreachTextRecipient.createMany({
    data: Array.from({ length: RECIPIENTS }, (_, n) => ({
      outreachId: outreach.id,
      organizationSlug: ORG,
      personId: `person-${outreach.id}-${n}`,
      phone: `+130355501${String(n).padStart(2, '0')}`,
    })),
  })
  await service.prisma.outreachTextHandoff.create({
    data: {
      outreachId: outreach.id,
      handler: 'agent',
      mode: 'shadow',
      sendAt: addHours(new Date(), 5),
      timeZone: 'America/New_York',
      claimedAt: new Date(),
      claimToken: TOKEN,
      ...handoff,
    },
  })
  return { id: outreach.id, waveId: managedWave.id }
}

const handoffOf = (id: number) =>
  service.prisma.outreachTextHandoff.findUniqueOrThrow({
    where: { outreachId: id },
  })
const waveOf = (id: string) =>
  service.prisma.managedPanelWave.findUniqueOrThrow({ where: { id } })

const vendor = {
  vendorCampaignName: '[Serve] Civic Test W1',
  sendingNumber: '+13035550000',
  audienceCount: RECIPIENTS,
}
const SCHEDULED_FOR = new Date('2026-11-07T16:00:00.000Z')
const scheduled = (overrides: Record<string, unknown> = {}) => ({
  status: 'scheduled',
  claimToken: TOKEN,
  ...vendor,
  scheduledFor: SCHEDULED_FOR.toISOString(),
  ...overrides,
})

const report = async (id: number, body: Record<string, unknown>) =>
  service.client.post(`${BASE}/${id}/report`, body, await swarm())

const tracked = (event: string) =>
  track.mock.calls
    .filter(([, name]) => name === event)
    .map(([, , properties]) => properties)

describe('hand-off report and replies routes', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('ES384', { extractable: true })
    jwksBody = JSON.stringify({
      keys: [{ ...(await exportJWK(keys.publicKey)), kid: KID, alg: 'ES384' }],
    })
  })

  beforeEach(async () => {
    vi.stubEnv('AWS_OIDC_ISSUER', ISSUER)
    vi.stubEnv('AWS_OIDC_HANDOFF_AGENT_ROLES', ROLE)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith(`${ISSUER}/`)) return realFetch(input, init)
      return new Response(jwksBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)
    slackMessage = vi
      .spyOn(service.app.get(SlackService), 'message')
      .mockResolvedValue(undefined)
    await service.prisma.organization.create({
      data: { slug: ORG, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: { organizationSlug: ORG, userId: service.user.id },
    })
    const panel = await service.prisma.managedCivicPanel.create({
      data: {
        organizationSlug: ORG,
        inviteMessage: 'Join our panel',
        consentVersion: 'v1',
        approvedAt: new Date(),
        goalMembers: 100,
      },
    })
    panelId = panel.id
  })

  describe('POST :outreachId/report', () => {
    it('rejects a caller that is not the swarm', async () => {
      const { id } = await seed()

      const res = await service.client.post(`${BASE}/${id}/report`, scheduled())

      expect(res.status).toBe(403)
      expect((await handoffOf(id)).status).toBe(OutreachHandoffStatus.queued)
    })

    it('404s for an outreach with no agent hand-off', async () => {
      const { id } = await seed({ handler: 'manual' })

      expect((await report(id, scheduled())).status).toBe(404)
      expect((await report(999999, scheduled())).status).toBe(404)
    })

    it('records a built campaign and releases the claim', async () => {
      const { id } = await seed()

      const res = await report(id, {
        status: 'built',
        claimToken: TOKEN,
        ...vendor,
      })

      expect(res.status).toBe(200)
      expect(res.data).toEqual({
        outreachId: id,
        status: 'built',
        repliesDueAt: null,
      })
      expect(await handoffOf(id)).toMatchObject({
        status: OutreachHandoffStatus.built,
        ...vendor,
        claimedAt: null,
        claimToken: null,
      })
    })

    it('rejects a stale token and leaves the row and wave unchanged', async () => {
      const { id, waveId } = await seed({ claimToken: 'newer-claim' })

      const res = await report(id, scheduled())

      expect(res.status).toBe(409)
      expect(await handoffOf(id)).toMatchObject({
        status: OutreachHandoffStatus.queued,
        claimToken: 'newer-claim',
        scheduledAt: null,
      })
      expect((await waveOf(waveId)).replyWindowEndsAt).toBeNull()
      expect(tracked(EVENTS.Contacts.CivicPanelWaveSent)).toEqual([])
    })

    it('rejects a token from another hand-off', async () => {
      const first = await seed({ claimToken: 'first' }, 1)
      await seed({ claimToken: 'second' }, 2)

      const res = await report(first.id, scheduled({ claimToken: 'second' }))

      expect(res.status).toBe(409)
      expect((await handoffOf(first.id)).status).toBe(
        OutreachHandoffStatus.queued,
      )
    })

    describe('scheduled', () => {
      it('sets repliesDueAt and the wave window from the real send', async () => {
        const { id, waveId } = await seed()
        const due = addDays(SCHEDULED_FOR, MANAGED_WAVE_REPLY_DAYS)

        const res = await report(id, scheduled())

        expect(res.status).toBe(200)
        expect(res.data).toEqual({
          outreachId: id,
          status: 'scheduled',
          repliesDueAt: due.toISOString(),
        })
        expect(await handoffOf(id)).toMatchObject({
          status: OutreachHandoffStatus.scheduled,
          ...vendor,
          repliesDueAt: due,
          scheduledAt: expect.any(Date),
          claimedAt: null,
          claimToken: null,
        })
        expect((await waveOf(waveId)).replyWindowEndsAt).toEqual(due)
      })

      it('moves a built hand-off on to scheduled', async () => {
        const { id } = await seed({
          status: OutreachHandoffStatus.built,
          ...vendor,
        })

        expect((await report(id, scheduled())).status).toBe(200)
        expect((await handoffOf(id)).status).toBe(
          OutreachHandoffStatus.scheduled,
        )
      })

      it('fires Wave Sent once for the agent, with the hand-off and lead time', async () => {
        const { id } = await seed()

        await report(id, scheduled())
        await report(id, scheduled())

        await vi.waitFor(() =>
          expect(tracked(EVENTS.Contacts.CivicPanelWaveSent)).toEqual([
            {
              organizationSlug: ORG,
              wave: 1,
              texts: RECIPIENTS,
              sendDate: '2026-11-07',
              steeredToward: 'renters',
              handoff: 'agent',
              hoursFromDraw: expect.any(Number),
            },
          ]),
        )
      })

      it.each([
        ['exactly 85%', 17, 200],
        ['just under 85%', 16, 409],
        ['one more than the recipients', RECIPIENTS + 1, 409],
        ['all of them', RECIPIENTS, 200],
      ])('audience %s -> %i is %i', async (_label, audienceCount, expected) => {
        const { id, waveId } = await seed()

        const res = await report(id, scheduled({ audienceCount }))

        expect(res.status).toBe(expected)
        if (expected === 409) {
          expect(await handoffOf(id)).toMatchObject({
            status: OutreachHandoffStatus.queued,
            claimToken: TOKEN,
            audienceCount: null,
          })
          expect((await waveOf(waveId)).replyWindowEndsAt).toBeNull()
          expect(tracked(EVENTS.Contacts.CivicPanelWaveSent)).toEqual([])
        }
      })

      it('answers a retry from the persisted row without a second write', async () => {
        const { id, waveId } = await seed()
        const first = await report(id, scheduled())
        const windowAfterFirst = (await waveOf(waveId)).replyWindowEndsAt

        const retry = await report(
          id,
          scheduled({ scheduledFor: addHours(SCHEDULED_FOR, 3).toISOString() }),
        )

        expect(retry.status).toBe(200)
        expect(retry.data).toEqual(first.data)
        expect((await waveOf(waveId)).replyWindowEndsAt).toEqual(
          windowAfterFirst,
        )
      })

      it('does not answer a different report with a settled row', async () => {
        const { id } = await seed()
        await report(id, scheduled())

        const res = await report(id, scheduled({ audienceCount: 18 }))

        expect(res.status).toBe(409)
      })
    })

    describe('needs_human', () => {
      const needsHuman = {
        status: 'needs_human',
        claimToken: TOKEN,
        step: 'login',
        reason: 'The vendor console asked for a captcha',
      }

      it('records step and reason, alerts, and fires Wave Errored once', async () => {
        const { id, waveId } = await seed()

        const res = await report(id, needsHuman)
        const retry = await report(id, needsHuman)

        expect(res.status).toBe(200)
        expect(res.data).toEqual({
          outreachId: id,
          status: 'needs_human',
          repliesDueAt: null,
        })
        expect(retry.status).toBe(200)
        expect(await handoffOf(id)).toMatchObject({
          status: OutreachHandoffStatus.needs_human,
          needsHumanAt: expect.any(Date),
          needsHumanReason: 'login: The vendor console asked for a captcha',
          claimToken: null,
        })
        expect((await waveOf(waveId)).replyWindowEndsAt).toBeNull()
        await vi.waitFor(() =>
          expect(tracked(EVENTS.Contacts.CivicPanelWaveErrored)).toEqual([
            {
              organizationSlug: ORG,
              wave: 1,
              step: 'login',
              reason: 'login: The vendor console asked for a captcha',
            },
          ]),
        )
        expect(slackMessage).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(slackMessage.mock.calls[0]?.[0])).toContain(
          'login: The vendor console asked for a captcha',
        )
      })

      it('still records the hand-off when Slack fails', async () => {
        const { id } = await seed()
        slackMessage.mockRejectedValue(new Error('slack down'))

        const res = await report(id, needsHuman)

        expect(res.status).toBe(200)
        expect((await handoffOf(id)).status).toBe(
          OutreachHandoffStatus.needs_human,
        )
      })

      it('rejects a stale token without alerting', async () => {
        const { id } = await seed({ claimToken: 'newer' })

        const res = await report(id, needsHuman)

        expect(res.status).toBe(409)
        expect(slackMessage).not.toHaveBeenCalled()
        expect(tracked(EVENTS.Contacts.CivicPanelWaveErrored)).toEqual([])
      })
    })
  })

  describe('POST :outreachId/replies', () => {
    const csv = [
      'Contact Phone Number,Message Text,Sent At,Send Direction',
      '3035550100,JOIN,2026-11-09T15:04:05.000Z,INBOUND',
      '3035550101,STOP,2026-11-09T16:00:00.000Z,INBOUND',
    ].join('\n')
    const upload = async (id: number, dryRun: boolean) =>
      service.client.post(
        `${BASE}/${id}/replies`,
        { fileName: 'replies.csv', csv, dryRun, sourceLabel: 'delegate swarm' },
        await swarm(),
      )

    it('rejects a caller that is not the swarm', async () => {
      const { id } = await seed({ status: OutreachHandoffStatus.scheduled })

      const res = await service.client.post(`${BASE}/${id}/replies`, {
        fileName: 'replies.csv',
        csv,
        dryRun: true,
      })

      expect(res.status).toBe(403)
    })

    it('404s without an agent hand-off', async () => {
      const { id } = await seed({
        handler: 'manual',
        status: OutreachHandoffStatus.scheduled,
      })

      expect((await upload(id, true)).status).toBe(404)
      expect((await upload(999999, true)).status).toBe(404)
    })

    it.each([
      OutreachHandoffStatus.queued,
      OutreachHandoffStatus.built,
      OutreachHandoffStatus.needs_human,
      OutreachHandoffStatus.replies_submitted,
    ])('409s while the hand-off is %s', async (status) => {
      const { id } = await seed({ status })

      expect((await upload(id, false)).status).toBe(409)
      expect(
        await service.prisma.pollIndividualMessage.count({
          where: { outreachId: id },
        }),
      ).toBe(0)
    })

    it('runs a dry run without writing anything', async () => {
      const { id } = await seed({ status: OutreachHandoffStatus.scheduled })

      const res = await upload(id, true)

      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ committed: false, rowsParsed: 2 })
      expect((await handoffOf(id)).status).toBe(OutreachHandoffStatus.scheduled)
      expect(
        await service.prisma.pollIndividualMessage.count({
          where: { outreachId: id },
        }),
      ).toBe(0)
    })

    it('commits the replies and marks the hand-off replies_submitted', async () => {
      const { id } = await seed({ status: OutreachHandoffStatus.scheduled })

      const res = await upload(id, false)

      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ committed: true, matched: 2 })
      expect(await handoffOf(id)).toMatchObject({
        status: OutreachHandoffStatus.replies_submitted,
        repliesSubmittedAt: expect.any(Date),
      })
      expect(
        await service.prisma.pollIndividualMessage.count({
          where: { outreachId: id },
        }),
      ).toBeGreaterThan(0)
    })
  })
})
