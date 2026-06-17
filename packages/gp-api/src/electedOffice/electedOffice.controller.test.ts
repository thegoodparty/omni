import { useTestService } from '@/test-service'
import { Campaign } from '../generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'

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
  })

  describe('POST /elected-office', () => {
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
  })
})
