import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import { FeaturesService } from '@/features/services/features.service'
import { SupportStatusService } from '@/contactInteraction/services/supportStatus.service'
import { HttpService } from '@nestjs/axios'
import { NotFoundException } from '@nestjs/common'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const seedWinOrg = async (opts: {
  slug: string
  ownerId: number
  isPro: boolean
}) => {
  await service.prisma.organization.create({
    data: { slug: opts.slug, ownerId: opts.ownerId },
  })
  await service.prisma.campaign.create({
    data: {
      userId: opts.ownerId,
      slug: `${opts.slug}-campaign`,
      organizationSlug: opts.slug,
      isPro: opts.isPro,
    },
  })
}

const seedEoOrg = (slug: string, overrideDistrictId?: string) =>
  service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId },
  })

const enableVoterData = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

const interactionsPath = (personId: string) =>
  `/v1/contacts/${personId}/interactions`

// The write path now runs the same district-scoped person lookup every read
// path uses (findPerson), so a real people-api round trip would need a
// resolvable district on the org. Stubbed at the service layer — same
// pattern as contacts.controller.test.ts's gatedEndpoints — instead of wiring
// overrideDistrictId + a real HttpService response on every test.
const mockPersonFound = (personId: string) =>
  vi
    .spyOn(service.app.get(ContactsService), 'findPerson')
    .mockResolvedValue({ id: personId } as PersonOutput)

const mockPersonNotFound = () =>
  vi
    .spyOn(service.app.get(ContactsService), 'findPerson')
    .mockRejectedValue(new NotFoundException('Person not found'))

describe('Contact interactions routes', () => {
  describe('happy path per channel', () => {
    it('door knock with outcome and supportAnswer writes manual columns', async () => {
      const slug = `win-pro-dk-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-dk'
      mockPersonFound(personId)

      const result = await service.client.post(
        interactionsPath(personId),
        {
          channel: 'doorKnock',
          outcome: 'answered',
          supportAnswer: 'supporter',
        },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data).toMatchObject({
        channel: 'doorKnock',
        personId,
        outcome: 'answered',
        supportAnswer: 'supporter',
        manual: true,
        note: null,
      })

      const row =
        await service.prisma.contactInteractionDoorKnock.findUniqueOrThrow({
          where: { id: result.data.id },
        })
      expect(row.manual).toBe(true)
      expect(row.sourceId).toBeNull()
      expect(row.outcome).toBe('answered')
      expect(row.supportAnswer).toBe('supporter')
    }, 15_000)

    it('text with responded outcome sets respondedAt to occurredAt', async () => {
      const slug = `win-pro-text-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-text'
      mockPersonFound(personId)
      const occurredAt = '2026-06-01T12:00:00.000Z'

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'text', outcome: 'responded', occurredAt },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.outcome).toBe('responded')

      const row = await service.prisma.contactInteractionText.findUniqueOrThrow(
        { where: { id: result.data.id } },
      )
      expect(row.respondedAt?.toISOString()).toBe(occurredAt)
      expect(row.optedOutAt).toBeNull()
      expect(row.manual).toBe(true)
      expect(row.outreachId).toBeNull()
      expect(row.sourceEventId).toBeNull()
    }, 15_000)

    it('text with opted_out outcome sets optedOutAt to occurredAt', async () => {
      const slug = `win-pro-text-optout-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-text-optout'
      mockPersonFound(personId)
      const occurredAt = '2026-06-03T15:00:00.000Z'

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'text', outcome: 'opted_out', occurredAt },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.outcome).toBe('opted_out')

      const row = await service.prisma.contactInteractionText.findUniqueOrThrow(
        { where: { id: result.data.id } },
      )
      expect(row.optedOutAt?.toISOString()).toBe(occurredAt)
      expect(row.respondedAt).toBeNull()
      expect(row.manual).toBe(true)
    }, 15_000)

    it('text with no outcome leaves both timestamp columns null', async () => {
      const slug = `win-pro-text-noop-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-text-noop'
      mockPersonFound(personId)

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'text' },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.outcome).toBeNull()

      const row = await service.prisma.contactInteractionText.findUniqueOrThrow(
        { where: { id: result.data.id } },
      )
      expect(row.respondedAt).toBeNull()
      expect(row.optedOutAt).toBeNull()
      expect(row.manual).toBe(true)
    }, 15_000)

    it('robocall with voicemail_left sets voicemailLeftAt', async () => {
      const slug = `win-pro-robocall-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-robocall'
      mockPersonFound(personId)
      const occurredAt = '2026-06-02T09:30:00.000Z'

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'robocall', outcome: 'voicemail_left', occurredAt },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.outcome).toBe('voicemail_left')

      const row =
        await service.prisma.contactInteractionRobocall.findUniqueOrThrow({
          where: { id: result.data.id },
        })
      expect(row.voicemailLeftAt?.toISOString()).toBe(occurredAt)
      expect(row.answeredAt).toBeNull()
      expect(row.manual).toBe(true)
      expect(row.outreachId).toBeNull()
      expect(row.sourceCallId).toBeNull()
    }, 15_000)

    it('robocall with answered outcome sets answeredAt', async () => {
      const slug = `win-pro-robocall-answered-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-robocall-answered'
      mockPersonFound(personId)
      const occurredAt = '2026-06-04T10:15:00.000Z'

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'robocall', outcome: 'answered', occurredAt },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.outcome).toBe('answered')

      const row =
        await service.prisma.contactInteractionRobocall.findUniqueOrThrow({
          where: { id: result.data.id },
        })
      expect(row.answeredAt?.toISOString()).toBe(occurredAt)
      expect(row.voicemailLeftAt).toBeNull()
      expect(row.manual).toBe(true)
    }, 15_000)
  })

  describe('empty note', () => {
    // A controlled HTML/React input emits '' (not undefined) for a cleared
    // field. NoteSchema coerces '' to undefined so this is accepted, not a
    // 400, and the row's note column stays null rather than storing ''.
    it('note: "" is accepted and persists as a null note', async () => {
      const slug = `win-pro-note-empty-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-note-empty'
      mockPersonFound(personId)

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'doorKnock', outcome: 'not_home', note: '' },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.note).toBeNull()

      const row =
        await service.prisma.contactInteractionDoorKnock.findUniqueOrThrow({
          where: { id: result.data.id },
        })
      expect(row.note).toBeNull()
    }, 15_000)
  })

  describe('cross-channel invalid payloads', () => {
    it.each([
      {
        name: 'supportAnswer on a text payload',
        body: {
          channel: 'text',
          outcome: 'responded',
          supportAnswer: 'supporter',
        },
      },
      {
        name: 'not_home outcome on a robocall payload',
        body: { channel: 'robocall', outcome: 'not_home' },
      },
      {
        name: 'doorKnock without outcome',
        body: { channel: 'doorKnock', supportAnswer: 'supporter' },
      },
    ])('rejects $name with 400', async ({ body }) => {
      const slug = `win-pro-invalid-${Date.now()}-${Math.random()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }

      const result = await service.client.post(
        interactionsPath('person-1'),
        body,
        { headers },
      )

      expect(result.status).toBe(400)
    })
  })

  describe('non-pro Win campaign', () => {
    it('rejects with 400', async () => {
      const slug = `win-nonpro-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: false })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }

      const result = await service.client.post(
        interactionsPath('person-1'),
        { channel: 'doorKnock', outcome: 'not_home' },
        { headers },
      )

      expect(result.status).toBe(400)
    })
  })

  describe('eo- org', () => {
    // Unlike the Win happy-path tests above, this exercises the REAL
    // findPerson -> withOrgDistrictResolution path (only the people-api HTTP
    // call is mocked, same as contactsPersonDetail.test.ts) so the district
    // resolution an eo- org actually goes through in production is proven
    // here, not stubbed away.
    it('accepts a manually logged interaction', async () => {
      const slug = `eo-${Date.now()}`
      const personId = 'person-1'
      await seedEoOrg(slug, 'district-eo-interactions-uuid')
      const headers = { [ORG_SLUG_HEADER]: slug }
      vi.spyOn(service.app.get(HttpService), 'get').mockReturnValue(
        of({ data: { id: personId, firstName: 'Jane' } }) as never,
      )

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'doorKnock', outcome: 'refused_to_engage' },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.channel).toBe('doorKnock')
    }, 15_000)
  })

  describe('person not found in the org district', () => {
    it('404s and writes no interaction row', async () => {
      const slug = `win-pro-notfound-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      mockPersonNotFound()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-out-of-district'

      const result = await service.client.post(
        interactionsPath(personId),
        { channel: 'doorKnock', outcome: 'answered' },
        { headers },
      )

      expect(result.status).toBe(404)
      const count = await service.prisma.contactInteractionDoorKnock.count({
        where: { organizationSlug: slug, personId },
      })
      expect(count).toBe(0)
    }, 15_000)
  })

  describe('win-voter-data flag off', () => {
    it('rejects with 403', async () => {
      const slug = `win-flagoff-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      vi.spyOn(
        service.app.get(FeaturesService),
        'isFeatureEnabled',
      ).mockResolvedValue(false)
      const headers = { [ORG_SLUG_HEADER]: slug }

      const result = await service.client.post(
        interactionsPath('person-1'),
        { channel: 'doorKnock', outcome: 'not_home' },
        { headers },
      )

      expect(result.status).toBe(403)
    })
  })

  describe('support-status integration', () => {
    it('a manually logged supporter door knock flips the derived support status', async () => {
      const slug = `win-pro-support-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      enableVoterData()
      const headers = { [ORG_SLUG_HEADER]: slug }
      const personId = 'person-support'
      mockPersonFound(personId)

      const supportStatus = service.app.get(SupportStatusService)
      expect(
        (await supportStatus.statusForPeople(slug, [personId])).get(personId),
      ).toBe('unknown')

      const result = await service.client.post(
        interactionsPath(personId),
        {
          channel: 'doorKnock',
          outcome: 'answered',
          supportAnswer: 'supporter',
        },
        { headers },
      )
      expect(result.status).toBe(201)

      const statuses = await supportStatus.statusForPeople(slug, [personId])
      expect(statuses.get(personId)).toBe('supporter')
    }, 15_000)
  })
})
