import {
  exportJWK,
  generateKeyPair,
  GenerateKeyPairResult,
  SignJWT,
} from 'jose'
import { addHours, addMinutes, subHours, subMinutes } from 'date-fns'
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { useTestService } from '@/test-service'
import {
  ManagedCivicPanelStatus,
  OutreachHandoffStatus,
  OutreachType,
  Prisma,
} from '../generated/prisma'

const service = useTestService()

const ISSUER = 'https://abc123-def456.tokens.sts.global.api.aws'
const ROLE = 'arn:aws:iam::123456789012:role/delegate-swarm-host'
const OTHER_ROLE = 'arn:aws:iam::123456789012:role/some-other-role'
const KID = 'test-aws-key'
const BASE = '/v1/outreach/agent/handoffs'
const ORG = 'handoff-org'

let keys: GenerateKeyPairResult
let jwksBody: string
const realFetch = globalThis.fetch

const signAwsToken = (sub = ROLE): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'ES384', kid: KID, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience('gp-api')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(keys.privateKey)

const swarm = async () => ({
  headers: { Authorization: `Bearer ${await signAwsToken()}` },
})

type SeedOptions = Partial<
  Omit<Prisma.OutreachTextHandoffUncheckedCreateInput, 'outreachId'>
> & { wave?: number; panelStatus?: ManagedCivicPanelStatus }

let panelId: string

const seed = async ({
  wave = 1,
  panelStatus: _ignored,
  ...handoff
}: SeedOptions = {}) => {
  const managedWave = await service.prisma.managedPanelWave.create({
    data: { enrollmentId: panelId, wave },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: ORG,
      outreachType: OutreachType.text,
      message: `Wave ${wave} invite`,
      managedPanelWaveId: managedWave.id,
    },
  })
  await service.prisma.outreachTextRecipient.createMany({
    data: [1, 2, 3].map((n) => ({
      outreachId: outreach.id,
      organizationSlug: ORG,
      personId: `person-${outreach.id}-${n}`,
      phone: `+1303555010${n}`,
    })),
  })
  await service.prisma.outreachTextHandoff.create({
    data: {
      outreachId: outreach.id,
      handler: 'agent',
      mode: 'shadow',
      sendAt: addHours(new Date(), 5),
      timeZone: 'America/New_York',
      ...handoff,
    },
  })
  return outreach.id
}

describe('hand-off agent routes', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('ES384', { extractable: true })
    jwksBody = JSON.stringify({
      keys: [{ ...(await exportJWK(keys.publicKey)), kid: KID, alg: 'ES384' }],
    })
  })

  beforeEach(async () => {
    vi.stubEnv('AWS_OIDC_ISSUER', ISSUER)
    vi.stubEnv('AWS_OIDC_HANDOFF_AGENT_ROLES', ROLE)
    vi.stubEnv('SQS_QUEUE', 'handoff-test-Queue.fifo')
    vi.stubEnv('OUTREACH_TEXT_CSVS_BUCKET', 'handoff-test-bucket')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith(`${ISSUER}/`)) return realFetch(input, init)
      return new Response(jwksBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await service.prisma.organization.create({
      data: { slug: ORG, ownerId: service.user.id },
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

  describe('authorization', () => {
    it('accepts the swarm AWS token on both routes', async () => {
      const id = await seed()

      const list = await service.client.get(BASE, await swarm())
      const claim = await service.client.post(
        `${BASE}/${id}/claim`,
        {},
        await swarm(),
      )

      expect(list.status).toBe(200)
      expect(claim.status).toBe(200)
    })

    describe('with a full M2M token', () => {
      let verifyM2MToken: ReturnType<typeof vi.spyOn>

      beforeEach(() => {
        verifyM2MToken = vi
          .spyOn(
            service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
            'verifyM2MToken',
          )
          .mockResolvedValue({ id: 'mt_test', subject: 'mch_test' })
      })

      afterEach(() => verifyM2MToken.mockRestore())

      it('passes both routes', async () => {
        const id = await seed()
        const headers = { Authorization: 'Bearer mt_test' }

        const list = await service.client.get(BASE, { headers })
        const claim = await service.client.post(
          `${BASE}/${id}/claim`,
          {},
          { headers },
        )

        expect(list.status).toBe(200)
        expect(claim.status).toBe(200)
      })
    })

    it('rejects an ordinary user session on both routes', async () => {
      const id = await seed()

      const list = await service.client.get(BASE)
      const claim = await service.client.post(`${BASE}/${id}/claim`, {})

      expect(list.status).toBe(403)
      expect(claim.status).toBe(403)
    })

    it('rejects an AWS token for a role that is not allowlisted', async () => {
      const id = await seed()
      const headers = {
        Authorization: `Bearer ${await signAwsToken(OTHER_ROLE)}`,
      }

      const list = await service.client.get(BASE, { headers })
      const claim = await service.client.post(
        `${BASE}/${id}/claim`,
        {},
        { headers },
      )

      expect(list.status).toBe(401)
      expect(claim.status).toBe(401)
    })
  })

  describe('GET /outreach/agent/handoffs', () => {
    it('returns the three due classes with their action', async () => {
      const now = new Date()
      const schedule = await seed({ wave: 1 })
      const confirm = await seed({
        wave: 2,
        status: OutreachHandoffStatus.built,
        vendorCampaignName: 'STW campaign',
      })
      const replies = await seed({
        wave: 3,
        status: OutreachHandoffStatus.scheduled,
        sendAt: subHours(now, 60),
        repliesDueAt: subHours(now, 1),
      })

      const res = await service.client.get(BASE, await swarm())

      expect(res.status).toBe(200)
      const byId = new Map(
        res.data.items.map((item: { outreachId: number }) => [
          item.outreachId,
          item,
        ]),
      )
      expect(res.data.items).toHaveLength(3)
      expect(byId.get(schedule)).toMatchObject({
        action: 'schedule',
        mode: 'shadow',
        wave: 1,
        message: 'Wave 1 invite',
        recipientCount: 3,
        timeZone: 'America/New_York',
        vendorCampaignName: null,
        repliesDueAt: null,
        campaignName: expect.stringMatching(
          new RegExp(`^\\[Serve\\] Civic .+ W1 #${schedule}$`),
        ),
      })
      expect(byId.get(confirm)).toMatchObject({
        action: 'confirm_scheduled',
        vendorCampaignName: 'STW campaign',
      })
      expect(byId.get(replies)).toMatchObject({
        action: 'export_replies',
        repliesDueAt: expect.any(String),
      })
    })

    it('leaves out rows that are not due', async () => {
      const now = new Date()
      await seed({ wave: 1, sendAt: addMinutes(now, 90) })
      await seed({ wave: 2, handler: 'manual' })
      await seed({ wave: 3, status: OutreachHandoffStatus.built, mode: 'auto' })
      await seed({
        wave: 4,
        status: OutreachHandoffStatus.scheduled,
        repliesDueAt: addHours(now, 2),
      })
      await seed({
        wave: 5,
        status: OutreachHandoffStatus.scheduled,
        repliesDueAt: subHours(now, 1),
        repliesSubmittedAt: subMinutes(now, 5),
      })
      await seed({
        wave: 6,
        status: OutreachHandoffStatus.needs_human,
        needsHumanAt: now,
      })
      await seed({
        wave: 7,
        needsHumanAt: now,
      })

      const res = await service.client.get(BASE, await swarm())

      expect(res.data.items).toEqual([])
    })

    it('leaves out a queued row once its panel is paused', async () => {
      await seed()
      await service.prisma.managedCivicPanel.update({
        where: { id: panelId },
        data: { status: ManagedCivicPanelStatus.paused },
      })

      const res = await service.client.get(BASE, await swarm())

      expect(res.data.items).toEqual([])
    })

    it('leaves out a live claim and lists it again after the TTL', async () => {
      const live = await seed({ wave: 1 })
      const stale = await seed({ wave: 2 })
      const now = new Date()
      await service.prisma.outreachTextHandoff.update({
        where: { outreachId: live },
        data: { claimedAt: subMinutes(now, 5), claimToken: 'live' },
      })
      await service.prisma.outreachTextHandoff.update({
        where: { outreachId: stale },
        data: { claimedAt: subMinutes(now, 25), claimToken: 'stale' },
      })

      const res = await service.client.get(BASE, await swarm())

      expect(
        res.data.items.map((item: { outreachId: number }) => item.outreachId),
      ).toEqual([stale])
    })
  })

  describe('POST /outreach/agent/handoffs/:outreachId/claim', () => {
    it('stores the claim and returns a 15 minute presigned CSV link', async () => {
      const id = await seed()

      const res = await service.client.post(
        `${BASE}/${id}/claim`,
        {},
        await swarm(),
      )

      const row = await service.prisma.outreachTextHandoff.findUniqueOrThrow({
        where: { outreachId: id },
      })
      expect(res.status).toBe(200)
      expect(res.data.claimToken).toBe(row.claimToken)
      expect(new Date(res.data.claimExpiresAt).getTime()).toBe(
        addMinutes(row.claimedAt as Date, 20).getTime(),
      )
      const url = new URL(res.data.recipientsCsvUrl)
      expect(url.pathname).toBe(`/handoff-test/${id}-1.csv`)
      expect(url.hostname).toContain('handoff-test-bucket')
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    })

    it('gives 409 to a second claim while the first is live', async () => {
      const id = await seed()

      await service.client.post(`${BASE}/${id}/claim`, {}, await swarm())
      const second = await service.client.post(
        `${BASE}/${id}/claim`,
        {},
        await swarm(),
      )

      expect(second.status).toBe(409)
    })

    it('lets exactly one of two concurrent claims win', async () => {
      const id = await seed()
      const headers = (await swarm()).headers

      const results = await Promise.all([
        service.client.post(`${BASE}/${id}/claim`, {}, { headers }),
        service.client.post(`${BASE}/${id}/claim`, {}, { headers }),
      ])

      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      const winner = results.find((r) => r.status === 200)
      const row = await service.prisma.outreachTextHandoff.findUniqueOrThrow({
        where: { outreachId: id },
      })
      expect(winner?.data.claimToken).toBe(row.claimToken)
    })

    it('re-claims a stale claim with a new token', async () => {
      const id = await seed()
      await service.prisma.outreachTextHandoff.update({
        where: { outreachId: id },
        data: { claimedAt: subMinutes(new Date(), 21), claimToken: 'old' },
      })

      const res = await service.client.post(
        `${BASE}/${id}/claim`,
        {},
        await swarm(),
      )

      expect(res.status).toBe(200)
      expect(res.data.claimToken).not.toBe('old')
    })

    it('refuses a row that is not due or needs a person', async () => {
      const paused = await seed({ wave: 1 })
      const human = await seed({ wave: 2, needsHumanAt: new Date() })
      await service.prisma.managedCivicPanel.update({
        where: { id: panelId },
        data: { status: ManagedCivicPanelStatus.paused },
      })

      const a = await service.client.post(
        `${BASE}/${paused}/claim`,
        {},
        await swarm(),
      )
      const b = await service.client.post(
        `${BASE}/${human}/claim`,
        {},
        await swarm(),
      )

      expect([a.status, b.status]).toEqual([409, 409])
    })

    it('is a 404 for an outreach with no hand-off', async () => {
      const res = await service.client.post(
        `${BASE}/99999999/claim`,
        {},
        await swarm(),
      )

      expect(res.status).toBe(404)
    })
  })
})
