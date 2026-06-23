import { useTestService } from '@/test-service'
import { IncomingRequest } from '@/authentication/authentication.types'
import { Campaign, User } from '../generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { ElectedOfficeController } from './electedOffice.controller'

const service = useTestService()

describe('ElectedOfficeController', () => {
  let campaign: Campaign
  let orgSlug: string

  beforeEach(async () => {
    const suffix = Date.now()
    orgSlug = `campaign-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: orgSlug,
        ownerId: service.user.id,
        positionId: '2875e5f3-ecf0-6fae-f270-6951f85e8468',
      },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `test-campaign-${suffix}`,
        organizationSlug: orgSlug,
      },
    })
  })

  const createElectedOffice = (body: Record<string, unknown> = {}) =>
    service.client.post('/v1/elected-office', body, {
      headers: { 'x-organization-slug': orgSlug },
    })

  describe('GET /elected-office/current', () => {
    it('returns current elected office', async () => {
      const created = await createElectedOffice({
        swornInDate: '2024-01-15',
      })
      expect(created.status).toBe(200)

      const eoOrgSlug = `eo-${created.data.id}`
      const result = await service.client.get('/v1/elected-office/current', {
        headers: { 'x-organization-slug': eoOrgSlug },
      })

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: created.data.id,
        swornInDate: '2024-01-15',
      })
    })

    it('returns 404 when no elected office exists', async () => {
      const result = await service.client.get('/v1/elected-office/current', {
        headers: { 'x-organization-slug': orgSlug },
      })

      expect(result.status).toBe(404)
    })

    it('resolves elected office via x-organization-slug header', async () => {
      const created = await createElectedOffice({
        swornInDate: '2024-01-15',
      })
      expect(created.status).toBe(200)

      const eoOrgSlug = `eo-${created.data.id}`
      const result = await service.client.get('/v1/elected-office/current', {
        headers: { 'x-organization-slug': eoOrgSlug },
      })

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: created.data.id,
        swornInDate: '2024-01-15',
      })
    })

    it('returns 404 when x-organization-slug does not match any elected office', async () => {
      const result = await service.client.get('/v1/elected-office/current', {
        headers: { 'x-organization-slug': 'nonexistent-org' },
      })

      expect(result.status).toBe(404)
    })

    it('returns 404 when org belongs to another user', async () => {
      const otherUser = await service.prisma.user.create({
        data: {
          email: 'other-eo@goodparty.org',
          firstName: 'Other',
          lastName: 'User',
        },
      })

      const otherOrg = await service.prisma.organization.create({
        data: {
          slug: `other-eo-org-${Date.now()}`,
          ownerId: otherUser.id,
        },
      })

      await service.prisma.electedOffice.create({
        data: {
          userId: otherUser.id,
          campaignId: campaign.id,
          organizationSlug: otherOrg.slug,
        },
      })

      const result = await service.client.get('/v1/elected-office/current', {
        headers: { 'x-organization-slug': otherOrg.slug },
      })

      expect(result.status).toBe(404)
    })
  })

  describe('GET /elected-office/:id', () => {
    it('returns toApi format for owner', async () => {
      const created = await createElectedOffice({
        swornInDate: '2024-01-15',
      })

      const result = await service.client.get(
        `/v1/elected-office/${created.data.id}`,
      )

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: created.data.id,
        swornInDate: '2024-01-15',
      })
    })

    it('returns 404 when elected office does not exist', async () => {
      const result = await service.client.get(
        '/v1/elected-office/nonexistent-id',
      )

      expect(result.status).toBe(404)
    })

    it('returns 403 when user does not own the record', async () => {
      const otherUser = await service.prisma.user.create({
        data: {
          email: 'other@goodparty.org',
          firstName: 'Other',
          lastName: 'User',
        },
      })

      const otherOrgSlug = `campaign-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherOrgSlug, ownerId: otherUser.id },
      })
      await service.prisma.campaign.create({
        data: {
          userId: otherUser.id,
          slug: `other-campaign-${Date.now()}`,
          organizationSlug: otherOrgSlug,
        },
      })

      const eoOrgSlug = `eo-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: eoOrgSlug, ownerId: otherUser.id },
      })
      const office = await service.prisma.electedOffice.create({
        data: {
          userId: otherUser.id,
          campaignId: campaign.id,
          organizationSlug: eoOrgSlug,
        },
      })

      const result = await service.client.get(`/v1/elected-office/${office.id}`)

      expect(result.status).toBe(403)
    })
  })

  describe('GET /elected-office/mine', () => {
    const createOfficeForUser = async (
      userId: number,
      data: Record<string, unknown> = {},
    ) => {
      const slug = `eo-mine-${userId}-${Math.random().toString(36).slice(2, 8)}`
      await service.prisma.organization.create({
        data: { slug, ownerId: userId },
      })
      return service.prisma.electedOffice.create({
        data: { userId, organizationSlug: slug, ...data },
      })
    }

    it("returns only the authenticated user's offices, scoped by userId", async () => {
      // Two offices for the caller (out of term order) plus one owned by a
      // different user — the response must contain exactly the caller's two,
      // ordered by termStartDate ascending, and never the other user's.
      const mineLater = await createOfficeForUser(service.user.id, {
        termStartDate: new Date('2025-01-01T00:00:00.000Z'),
      })
      const mineEarlier = await createOfficeForUser(service.user.id, {
        termStartDate: new Date('2021-01-01T00:00:00.000Z'),
      })

      const otherUser = await service.prisma.user.create({
        data: {
          email: `other-mine-${Date.now()}@goodparty.org`,
          firstName: 'Other',
          lastName: 'User',
        },
      })
      const theirs = await createOfficeForUser(otherUser.id)

      const result = await service.client.get('/v1/elected-office/mine')

      expect(result.status).toBe(200)
      const ids = (result.data as { id: string }[]).map((o) => o.id)
      expect(ids).toEqual([mineEarlier.id, mineLater.id])
      expect(ids).not.toContain(theirs.id)
    })

    it('returns an empty array when the user holds no offices', async () => {
      const result = await service.client.get('/v1/elected-office/mine')

      expect(result.status).toBe(200)
      expect(result.data).toEqual([])
    })

    it('rejects an unauthenticated request', async () => {
      const result = await service.client.get('/v1/elected-office/mine', {
        headers: { Authorization: 'Bearer not-a-valid-token' },
      })

      expect(result.status).toBe(401)
    })

    it('rejects an M2M token that carries no user context', async () => {
      // The global SessionGuard admits M2M tokens without populating
      // request.user; listMine must reject rather than dereference user.id.
      const controller = service.app.get(ElectedOfficeController)

      await expect(
        controller.listMine(undefined as unknown as User),
      ).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('create rejects an M2M token that carries no user context', async () => {
      // Same guard for POST: an M2M create has no owner to attach the office to.
      const controller = service.app.get(ElectedOfficeController)

      await expect(
        controller.create(undefined as unknown as User, {} as never, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException)
    })
  })

  describe('POST /elected-office', () => {
    it('rejects creating a term-less office already marked onboarding-complete', async () => {
      // Mirrors the PUT guard: a completed term-less placeholder would
      // permanently bypass the serve-onboarding redirect.
      const result = await service.client.post('/v1/elected-office', {
        onboardingCompletedAt: '2026-02-01T00:00:00.000Z',
      })

      expect(result.status).toBe(400)
    })

    it('rejects creating a start-only office already marked onboarding-complete', async () => {
      // Completion requires a full term: a start-only (indefinite) term would
      // strand the EO in the dashboard term-date modal's un-satisfiable loop.
      const result = await service.client.post('/v1/elected-office', {
        termStartDate: '2025-01-01',
        onboardingCompletedAt: '2026-02-01T00:00:00.000Z',
      })

      expect(result.status).toBe(400)
    })

    it('fills a placeholder with the full POST payload, not just term dates', async () => {
      // A bare placeholder gets adopted by a later onboarding-completion POST
      // that carries term dates AND other fields; none of them should be lost.
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)
      expect(placeholder.data.termStartDate).toBeNull()

      const filled = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
        party: 'Independent',
        onboardingCompletedAt: '2026-02-01T00:00:00.000Z',
      })

      expect(filled.status).toBe(200)
      expect(filled.data.id).toBe(placeholder.data.id)
      expect(filled.data.party).toBe('Independent')
      expect(filled.data.onboardingCompletedAt).toBe('2026-02-01T00:00:00.000Z')
      expect(filled.data.termLengthDays).toBe(1461)
    })

    it('persists selfReported when the completion POST adopts a placeholder', async () => {
      // A truly net-new user (no prior EO) never reaches the party-step PUT, so
      // their marker is written only by the final completion POST. That POST
      // adopts the auto-provisioned placeholder via the create() update path —
      // assert selfReported survives that path so resume classifies them
      // net-new (not as a sales/BR prefill).
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)
      expect(placeholder.data.selfReported).toBe(false)

      const completed = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
        party: 'independent',
        onboardingCompletedAt: '2026-02-01T00:00:00.000Z',
        selfReported: true,
      })

      expect(completed.status).toBe(200)
      expect(completed.data.id).toBe(placeholder.data.id)
      expect(completed.data.selfReported).toBe(true)

      const electedOffice = await service.prisma.electedOffice.findFirst({
        where: { id: completed.data.id },
      })
      expect(electedOffice?.selfReported).toBe(true)
    })

    it('persists onboardingStep through the create / placeholder-adoption path', async () => {
      // create-on-first-answer POSTs a bare stub (no checkpoint), then the
      // completion POST adopts that placeholder carrying the final checkpoint —
      // assert it survives the create() update path.
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)
      expect(placeholder.data.onboardingStep).toBeNull()

      const completed = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
        onboardingStep: 'pledge',
      })

      expect(completed.status).toBe(200)
      expect(completed.data.id).toBe(placeholder.data.id)
      expect(completed.data.onboardingStep).toBe('pledge')
    })

    it('creates elected office when user has a campaign', async () => {
      const result = await createElectedOffice({
        swornInDate: '2024-01-15',
      })

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: expect.any(String),
        swornInDate: '2024-01-15',
      })

      const organization = await service.prisma.organization.findUnique({
        where: { slug: `eo-${result.data.id}` },
      })
      expect(organization).toBeDefined()
      expect(organization?.slug).toBe(`eo-${result.data.id}`)

      const electedOffice = await service.prisma.electedOffice.findFirst({
        where: { id: result.data.id },
      })
      expect(electedOffice).toBeDefined()
      expect(electedOffice?.organizationSlug).toBe(organization?.slug)
    })

    it('creates elected office with only required fields', async () => {
      const result = await createElectedOffice()

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: expect.any(String),
      })

      const organization = await service.prisma.organization.findUnique({
        where: { slug: `eo-${result.data.id}` },
      })
      expect(organization).toBeDefined()
      expect(organization?.slug).toBe(`eo-${result.data.id}`)

      const electedOffice = await service.prisma.electedOffice.findFirst({
        where: { id: result.data.id },
      })
      expect(electedOffice).toBeDefined()
      expect(electedOffice?.organizationSlug).toBe(organization?.slug)
    })

    it('creates elected office when organization has no positionId', async () => {
      await service.prisma.organization.update({
        where: { slug: campaign.organizationSlug ?? undefined },
        data: { positionId: null },
      })

      const result = await createElectedOffice()

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: expect.any(String),
      })
    })

    it('returns the existing elected office, ignoring the new input, when one already exists', async () => {
      const first = await createElectedOffice({ swornInDate: '2024-01-15' })
      expect(first.status).toBe(200)

      const second = await createElectedOffice({ swornInDate: '2025-06-01' })
      expect(second.status).toBe(200)
      expect(second.data.id).toBe(first.data.id)
      expect(second.data.swornInDate).toBe('2024-01-15')

      const offices = await service.prisma.electedOffice.findMany({
        where: { userId: service.user.id },
      })
      expect(offices).toHaveLength(1)
    })

    it('creates a campaign-less elected office when user has no campaign', async () => {
      await service.prisma.campaign.deleteMany({
        where: { userId: service.user.id },
      })

      const result = await createElectedOffice({ swornInDate: '2024-01-15' })

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: expect.any(String),
        swornInDate: '2024-01-15',
      })

      const electedOffice = await service.prisma.electedOffice.findFirst({
        where: { id: result.data.id },
      })
      expect(electedOffice?.campaignId).toBeNull()
    })

    it('creates a campaign-less elected office with office identity from the body when there is no organization', async () => {
      // No x-organization-slug header → no organization context, so the office
      // identity must come from the request body.
      const result = await service.client.post('/v1/elected-office', {
        swornInDate: '2024-01-15',
        ballotReadyPositionId: 'br-pos-from-body',
      })

      expect(result.status).toBe(200)

      const organization = await service.prisma.organization.findUnique({
        where: { slug: `eo-${result.data.id}` },
      })
      expect(organization?.positionId).toBe('br-pos-from-body')
    })

    it('rejects an elected office whose term overlaps an existing one', async () => {
      const first = await createElectedOffice({
        termStartDate: '2024-01-01',
        termEndDate: '2028-01-01',
      })
      expect(first.status).toBe(200)

      const overlapping = await createElectedOffice({
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
      })
      expect(overlapping.status).toBe(409)
    })

    it('adopts a term-less placeholder instead of creating a duplicate when term dates arrive later', async () => {
      // A magic-link lead is provisioned with a term-less placeholder office.
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)

      // A later create carrying term dates must adopt the placeholder rather
      // than insert a second office — a term-less range never "overlaps", so
      // without the placeholder guard this would slip past the overlap check.
      const withDates = await createElectedOffice({
        termStartDate: '2024-01-01',
        termEndDate: '2028-01-01',
      })
      expect(withDates.status).toBe(200)
      expect(withDates.data.id).toBe(placeholder.data.id)

      const offices = await service.prisma.electedOffice.findMany({
        where: { userId: service.user.id },
      })
      expect(offices).toHaveLength(1)
    })

    it('rejects a term whose end date is before its start date', async () => {
      const result = await createElectedOffice({
        termStartDate: '2028-01-01',
        termEndDate: '2024-01-01',
      })
      expect(result.status).toBe(400)
    })

    it('rejects a zero-length term (end equal to start)', async () => {
      const result = await createElectedOffice({
        termStartDate: '2024-01-01',
        termEndDate: '2024-01-01',
      })
      expect(result.status).toBe(400)
    })

    it('accepts a term whose end date is after its start date', async () => {
      const result = await createElectedOffice({
        termStartDate: '2024-01-01',
        termEndDate: '2028-01-01',
      })
      expect(result.status).toBe(200)
    })
  })

  describe('PUT /elected-office/:id', () => {
    it('updates elected office fields', async () => {
      const created = await createElectedOffice()

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        {
          swornInDate: '2024-01-15',
        },
      )

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: created.data.id,
        swornInDate: '2024-01-15',
      })
    })

    it('returns 404 when elected office does not exist', async () => {
      const result = await service.client.put(
        '/v1/elected-office/nonexistent-id',
        { swornInDate: '2024-01-15' },
      )

      expect(result.status).toBe(404)
    })

    it('returns 403 when user does not own the record', async () => {
      const otherUser = await service.prisma.user.create({
        data: {
          email: 'other@goodparty.org',
          firstName: 'Other',
          lastName: 'User',
        },
      })

      const eoOrgSlug = `eo-update-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: eoOrgSlug, ownerId: otherUser.id },
      })
      const office = await service.prisma.electedOffice.create({
        data: {
          userId: otherUser.id,
          campaignId: campaign.id,
          organizationSlug: eoOrgSlug,
        },
      })

      const result = await service.client.put(
        `/v1/elected-office/${office.id}`,
        { swornInDate: '2024-01-15' },
      )

      expect(result.status).toBe(403)
    })

    it('rejects an update whose end date is before its start date', async () => {
      const created = await createElectedOffice()

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        {
          termStartDate: '2028-01-01',
          termEndDate: '2024-01-01',
        },
      )

      expect(result.status).toBe(400)
    })

    it('rejects a partial update that inverts the term against the existing bound', async () => {
      // Only termEndDate is in the body, but it lands on/before the existing
      // termStartDate — the schema's both-bounds refinement doesn't catch this,
      // so the controller must validate the effective bounds.
      const created = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      })
      expect(created.status).toBe(200)

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { termEndDate: '2024-06-01' },
      )

      expect(result.status).toBe(400)
    })

    it('rejects an update whose term would overlap another office the user holds', async () => {
      const first = await createElectedOffice({
        termStartDate: '2024-01-01',
        termEndDate: '2028-01-01',
      })
      expect(first.status).toBe(200)

      // A second, non-overlapping office is allowed.
      const second = await createElectedOffice({
        termStartDate: '2030-01-01',
        termEndDate: '2034-01-01',
      })
      expect(second.status).toBe(200)
      expect(second.data.id).not.toBe(first.data.id)

      // Moving the second office's term into the first office's range must be
      // rejected, mirroring the create-time no-overlap invariant.
      const result = await service.client.put(
        `/v1/elected-office/${second.data.id}`,
        {
          termStartDate: '2025-01-01',
          termEndDate: '2027-01-01',
        },
      )
      expect(result.status).toBe(409)
    })

    it('updates elected office with null values', async () => {
      const created = await createElectedOffice({
        swornInDate: '2024-01-15',
      })

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        {
          swornInDate: null,
        },
      )

      expect(result.status).toBe(200)
      expect(result.data).toMatchObject({
        id: created.data.id,
      })
      expect(result.data.swornInDate).toBeNull()
    })

    it('rejects completing onboarding on a term-less placeholder', async () => {
      // A term-less placeholder (bare magic-link lead) must not be markable as
      // onboarding-complete — that would permanently skip the serve flow.
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)
      expect(placeholder.data.termStartDate).toBeNull()

      const result = await service.client.put(
        `/v1/elected-office/${placeholder.data.id}`,
        { onboardingCompletedAt: '2026-02-01T00:00:00.000Z' },
      )

      expect(result.status).toBe(400)
    })

    it('allows completing onboarding once the office has term dates', async () => {
      const created = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      })
      expect(created.status).toBe(200)

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { onboardingCompletedAt: '2026-02-01T00:00:00.000Z' },
      )

      expect(result.status).toBe(200)
      expect(result.data.onboardingCompletedAt).toBe('2026-02-01T00:00:00.000Z')
    })

    it('persists the selfReported marker via a partial PUT (defaults to false)', async () => {
      // The net-new serve onboarding flow stamps this on the party-step PUT to
      // mark the office as the user's own pick (vs a sales/BR prefill).
      const created = await createElectedOffice()
      expect(created.status).toBe(200)
      expect(created.data.selfReported).toBe(false)

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { party: 'independent', selfReported: true },
      )

      expect(result.status).toBe(200)
      expect(result.data.selfReported).toBe(true)
      expect(result.data.party).toBe('independent')
    })

    it('persists the onboardingStep checkpoint via a partial PUT', async () => {
      // Each "Continue" writes the furthest step reached so resume routes back
      // to it, even for steps with no other persisted data.
      const created = await createElectedOffice()
      expect(created.status).toBe(200)
      expect(created.data.onboardingStep).toBeNull()

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { onboardingStep: 'constituents' },
      )

      expect(result.status).toBe(200)
      expect(result.data.onboardingStep).toBe('constituents')
    })

    it('rejects an unknown onboardingStep value', async () => {
      // The column is validated against the known step set, so a typo or stale
      // client can't poison the resume pointer.
      const created = await createElectedOffice()
      expect(created.status).toBe(200)

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { onboardingStep: 'not-a-real-step' },
      )

      expect(result.status).toBe(400)
    })

    it('rejects downgrading selfReported from true to false', async () => {
      // selfReported is a one-way marker; downgrading it would reclassify a
      // net-new record as a prefill on resume. Setting it true is fine, but
      // true→false must be rejected.
      const created = await createElectedOffice()
      expect(created.status).toBe(200)
      const up = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { selfReported: true },
      )
      expect(up.status).toBe(200)
      expect(up.data.selfReported).toBe(true)

      const downgrade = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { selfReported: false },
      )
      expect(downgrade.status).toBe(403)

      // Idempotent re-set to true (and leaving it unset) still works.
      const reset = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { selfReported: true },
      )
      expect(reset.status).toBe(200)
      expect(reset.data.selfReported).toBe(true)
    })

    it('rejects completing onboarding with only a term end date (no start)', async () => {
      // A term with an end but no start isn't a real term; onboarding must not
      // complete against it.
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)

      const result = await service.client.put(
        `/v1/elected-office/${placeholder.data.id}`,
        {
          termEndDate: '2029-01-01',
          onboardingCompletedAt: '2026-02-01T00:00:00.000Z',
        },
      )

      expect(result.status).toBe(400)
    })

    it('rejects completing onboarding on a start-only term (no end)', async () => {
      // A valid term needs BOTH bounds. Completing onboarding on a start-only
      // (indefinite) term would land the EO in a state the dashboard term-date
      // modal perpetually re-prompts (it requires both dates to save) with no
      // way to satisfy it, so completion must require an end date too.
      const created = await createElectedOffice({ termStartDate: '2025-01-01' })
      expect(created.status).toBe(200)
      expect(created.data.termEndDate).toBeNull()

      const result = await service.client.put(
        `/v1/elected-office/${created.data.id}`,
        { onboardingCompletedAt: '2026-02-01T00:00:00.000Z' },
      )

      expect(result.status).toBe(400)
    })

    it('rejects completing onboarding when only a start is supplied alongside it', async () => {
      // Same guard via a partial PUT that sets the start and completion together
      // but leaves the end null.
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)

      const result = await service.client.put(
        `/v1/elected-office/${placeholder.data.id}`,
        {
          termStartDate: '2025-01-01',
          onboardingCompletedAt: '2026-02-01T00:00:00.000Z',
        },
      )

      expect(result.status).toBe(400)
    })

    it('derives termLengthDays in the response from supplied term dates', async () => {
      // termLengthDays is derived from the term dates at read time, so a
      // placeholder reports null until term dates are persisted (here via PUT).
      const placeholder = await createElectedOffice()
      expect(placeholder.status).toBe(200)
      expect(placeholder.data.termLengthDays).toBeNull()

      const result = await service.client.put(
        `/v1/elected-office/${placeholder.data.id}`,
        { termStartDate: '2025-01-01', termEndDate: '2029-01-01' },
      )

      expect(result.status).toBe(200)
      // 2025-01-01 -> 2029-01-01 spans 1461 calendar days (incl. the 2028 leap).
      expect(result.data.termLengthDays).toBe(1461)
    })

    const m2mRequest = () =>
      ({
        m2mToken: { sub: 'svc' },
        user: undefined,
      }) as unknown as IncomingRequest

    it('rejects an M2M update that sets onboardingCompletedAt', async () => {
      // onboardingCompletedAt gates the serve-onboarding redirect; an M2M token
      // (no user context) must not be able to suppress it for any user.
      const created = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      })
      expect(created.status).toBe(200)
      const controller = service.app.get(ElectedOfficeController)

      await expect(
        controller.update(
          created.data.id,
          { onboardingCompletedAt: '2026-02-01T00:00:00.000Z' } as never,
          m2mRequest(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('rejects an M2M update that clears onboardingCompletedAt (null)', async () => {
      const created = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      })
      expect(created.status).toBe(200)
      const controller = service.app.get(ElectedOfficeController)

      await expect(
        controller.update(
          created.data.id,
          { onboardingCompletedAt: null } as never,
          m2mRequest(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('allows an M2M update of other fields (provisioning capability preserved)', async () => {
      const created = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      })
      expect(created.status).toBe(200)
      const controller = service.app.get(ElectedOfficeController)

      const updated = await controller.update(
        created.data.id,
        { party: 'Independent' } as never,
        m2mRequest(),
      )

      expect((updated as { party: string | null }).party).toBe('Independent')
    })

    it('rejects an M2M update that sets selfReported', async () => {
      // selfReported drives serve-onboarding routing; an M2M token (no user
      // context) must not be able to reclassify a prefilled record as net-new.
      const created = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      })
      expect(created.status).toBe(200)
      const controller = service.app.get(ElectedOfficeController)

      await expect(
        controller.update(
          created.data.id,
          { selfReported: true } as never,
          m2mRequest(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('rejects an M2M update that sets onboardingStep', async () => {
      // onboardingStep is the resume pointer written by the authenticated
      // onboarding flow; an M2M token (no user session) must not move it.
      const created = await createElectedOffice({
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      })
      expect(created.status).toBe(200)
      const controller = service.app.get(ElectedOfficeController)

      await expect(
        controller.update(
          created.data.id,
          { onboardingStep: 'party' } as never,
          m2mRequest(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })
  })
})
