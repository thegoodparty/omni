import { Test } from '@nestjs/testing'
import { ServeSmsCreateRequestSchema } from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { AUDIENCE_PAGE_SIZE } from '@/contacts/utils/audienceResolution.util'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { OutreachStatus, OutreachType } from 'src/generated/prisma'
import {
  assertServeSmsSendDateAllowed,
  MIN_SERVE_SMS_RECIPIENTS,
  OutreachServeSmsCreateService,
} from './outreachServeSmsCreate.service'

const ORG = 'eo-city-council'
const FILTER_ID = 55
const OUTREACH_ID = 4242

// A Monday, so the business-day arithmetic below is easy to read:
// +2 business days is Wednesday the 23rd, so Thursday the 24th is the first
// allowed day and the 30-day ceiling lands on Wednesday October 21st.
const MONDAY_NOON_UTC = new Date('2026-09-21T12:00:00Z')
const VALID_DATE = '2026-10-08' // a Thursday, comfortably inside the window

const request = (overrides: Record<string, unknown> = {}) => ({
  name: 'Budget hearing reminder',
  message:
    'The budget hearing is Thursday at 6pm at City Hall. Reply STOP to opt out.',
  scheduledLocalDate: VALID_DATE,
  voterFileFilterId: FILTER_ID,
  ...overrides,
})

// Only the fields the audience helper reads. people-api returns far more.
const people = (count: number, startAt = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: `person-${startAt + index}`,
    cellPhone: `512555${String(startAt + index).padStart(4, '0')}`,
  }))

// Fresh records carrying phone numbers this resolution has already seen —
// what people-api returns for a list where whole households share a number.
const repeatPhones = (count: number, tag: string) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${tag}-${index}`,
    cellPhone: `512555${String(index).padStart(4, '0')}`,
  }))

describe('OutreachServeSmsCreateService', () => {
  let service: OutreachServeSmsCreateService
  let prisma: { outreach: { create: ReturnType<typeof vi.fn> } }
  let contacts: { findContactsForFilter: ReturnType<typeof vi.fn> }
  let organizations: { findFirst: ReturnType<typeof vi.fn> }
  let filters: { findByIdAndOrganizationSlug: ReturnType<typeof vi.fn> }
  let texts: { findOptedOutPersonIds: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(MONDAY_NOON_UTC)

    prisma = {
      outreach: { create: vi.fn().mockResolvedValue({ id: OUTREACH_ID }) },
    }
    contacts = {
      findContactsForFilter: vi.fn().mockResolvedValue({ people: people(120) }),
    }
    organizations = {
      findFirst: vi.fn().mockResolvedValue({ id: 1, slug: ORG }),
    }
    filters = {
      findByIdAndOrganizationSlug: vi.fn().mockResolvedValue({
        id: FILTER_ID,
        organizationSlug: ORG,
        audienceSuperVoters: true,
      }),
    }
    texts = { findOptedOutPersonIds: vi.fn().mockResolvedValue([]) }

    const module = await Test.createTestingModule({
      providers: [
        OutreachServeSmsCreateService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContactsService, useValue: contacts },
        { provide: OrganizationsService, useValue: organizations },
        { provide: VoterFileFilterService, useValue: filters },
        { provide: ContactInteractionTextService, useValue: texts },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = module.get(OutreachServeSmsCreateService)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the count is server-derived', () => {
    it('writes the resolved count to textCount and ignores a client count', async () => {
      // The contract schema is the first line of defence: a count in the body
      // never even reaches the service.
      const parsed = ServeSmsCreateRequestSchema.parse(
        request({
          textCount: 999_999,
          recipientCount: 1,
          billableTextCount: 1,
          status: OutreachStatus.pending,
        }),
      )
      expect(parsed).not.toHaveProperty('textCount')
      expect(parsed).not.toHaveProperty('recipientCount')
      expect(parsed).not.toHaveProperty('status')

      const result = await service.createDraft(ORG, parsed)

      expect(result.recipientCount).toBe(120)
      const { data } = firstOrThrow(prisma.outreach.create.mock.calls)[0] as {
        data: Record<string, unknown>
      }
      expect(data.textCount).toBe(120)
    })

    it('persists the row as an org-scoped pending_payment text draft', async () => {
      await service.createDraft(ORG, request())

      const { data } = firstOrThrow(prisma.outreach.create.mock.calls)[0] as {
        data: Record<string, unknown>
      }
      expect(data).toMatchObject({
        campaignId: null,
        organizationSlug: ORG,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending_payment,
        scheduledLocalDate: VALID_DATE,
        voterFileFilterId: FILTER_ID,
        textCount: 120,
      })
      // Serve sends at a fixed 11am local — there is no chosen time to store.
      expect(data).not.toHaveProperty('scheduledLocalTime')
    })

    it('resolves the saved list rather than trusting the request for criteria', async () => {
      await service.createDraft(ORG, request())

      expect(filters.findByIdAndOrganizationSlug).toHaveBeenCalledWith(
        FILTER_ID,
        ORG,
      )
      const [filterInput] = firstOrThrow(
        contacts.findContactsForFilter.mock.calls,
      ) as [Record<string, unknown>]
      expect(filterInput).toMatchObject({
        audienceSuperVoters: true,
        // Reachability belongs to the channel, forced by the shared helper.
        hasCellPhone: true,
      })
    })

    it('reports the duplicate-phone count off the generator return value', async () => {
      // Two people share a number: the second is dropped and counted.
      contacts.findContactsForFilter.mockResolvedValue({
        people: [...people(40), { id: 'person-dupe', cellPhone: '5125550000' }],
      })

      const result = await service.createDraft(ORG, request())

      expect(result.recipientCount).toBe(40)
      expect(result.excludedDuplicateCount).toBe(1)
    })

    it('pages until a short page rather than stopping at the first', async () => {
      contacts.findContactsForFilter
        .mockResolvedValueOnce({ people: people(AUDIENCE_PAGE_SIZE) })
        .mockResolvedValueOnce({ people: people(30, AUDIENCE_PAGE_SIZE) })

      const result = await service.createDraft(ORG, request())

      expect(result.recipientCount).toBe(AUDIENCE_PAGE_SIZE + 30)
    })
  })

  describe('the opt-out scrub', () => {
    // Counting what THIS list lost, not the org's opt-out history, is the
    // whole point: the number is quoted on the pay step, and the delivery
    // layer has to agree with it when it re-resolves at send time. An org
    // with a long opt-out history whose list reaches two of them quotes two.
    it('counts only the people this list actually lost', async () => {
      texts.findOptedOutPersonIds.mockResolvedValue([
        'person-0',
        'person-1',
        // Historical opt-outs this filter never reaches. They must not
        // inflate the quote.
        ...Array.from({ length: 998 }, (_, i) => `elsewhere-${i}`),
      ])

      const result = await service.createDraft(ORG, request())

      expect(texts.findOptedOutPersonIds).toHaveBeenCalledWith(ORG)
      expect(result.excludedOptedOutCount).toBe(2)
      // 120 matched, 2 of them scrubbed.
      expect(result.recipientCount).toBe(118)
    })

    // The ids go to isEligible, not to people-api: as an upstream exclusion
    // filter those rows never come back, so the count above is not
    // computable. It also means the vendor's id-filter cap cannot silently
    // skip the scrub for a large org.
    it('scrubs in-process rather than as an upstream exclusion filter', async () => {
      texts.findOptedOutPersonIds.mockResolvedValue(['person-0'])

      await service.createDraft(ORG, request())

      const excludePersonIds = firstOrThrow(
        contacts.findContactsForFilter.mock.calls,
      )[3] as Set<string>
      expect(excludePersonIds).toEqual(new Set())
    })

    it('scrubs before the minimum is measured, so the floor sees the real audience', async () => {
      // 25 matched, one opted out — 24 reachable, below the floor.
      texts.findOptedOutPersonIds.mockResolvedValue(['person-0'])
      contacts.findContactsForFilter.mockResolvedValue({
        people: people(MIN_SERVE_SMS_RECIPIENTS),
      })

      await expect(service.createDraft(ORG, request())).rejects.toThrow(
        /reaches 24 constituents/,
      )
      expect(prisma.outreach.create).not.toHaveBeenCalled()
    })

    // An opted-out person is still a record people-api had not shown us, so
    // the resolver's stall guard must not read a page of them as repetition.
    it('does not let a scrubbed page trip the stall guard', async () => {
      texts.findOptedOutPersonIds.mockResolvedValue(
        Array.from({ length: AUDIENCE_PAGE_SIZE }, (_, i) => `optout-${i}`),
      )
      contacts.findContactsForFilter
        .mockResolvedValueOnce({ people: people(AUDIENCE_PAGE_SIZE) })
        .mockResolvedValueOnce({
          people: Array.from({ length: AUDIENCE_PAGE_SIZE }, (_, i) => ({
            id: `optout-${i}`,
            cellPhone: `919555${String(i).padStart(4, '0')}`,
          })),
        })
        .mockResolvedValueOnce({ people: people(5, AUDIENCE_PAGE_SIZE) })

      const result = await service.createDraft(ORG, request())

      expect(result.recipientCount).toBe(AUDIENCE_PAGE_SIZE + 5)
      expect(result.excludedOptedOutCount).toBe(AUDIENCE_PAGE_SIZE)
    })
  })

  describe(`the ${MIN_SERVE_SMS_RECIPIENTS}-recipient floor`, () => {
    it('rejects below the minimum and names the number', async () => {
      contacts.findContactsForFilter.mockResolvedValue({ people: people(24) })

      await expect(service.createDraft(ORG, request())).rejects.toThrow(
        /reaches 24 constituents.*at least 25/s,
      )
      expect(prisma.outreach.create).not.toHaveBeenCalled()
    })

    it('accepts exactly the minimum', async () => {
      contacts.findContactsForFilter.mockResolvedValue({
        people: people(MIN_SERVE_SMS_RECIPIENTS),
      })

      const result = await service.createDraft(ORG, request())

      expect(result.recipientCount).toBe(MIN_SERVE_SMS_RECIPIENTS)
      expect(prisma.outreach.create).toHaveBeenCalledOnce()
    })

    it('rejects an empty audience with the same message', async () => {
      contacts.findContactsForFilter.mockResolvedValue({ people: [] })

      await expect(service.createDraft(ORG, request())).rejects.toThrow(
        /reaches 0 constituents/,
      )
    })
  })

  describe('scope', () => {
    it('refuses a list that is not this org’s', async () => {
      filters.findByIdAndOrganizationSlug.mockResolvedValue(null)

      await expect(service.createDraft(ORG, request())).rejects.toThrow(
        'Constituent list not found',
      )
      expect(contacts.findContactsForFilter).not.toHaveBeenCalled()
    })

    it('refuses an unknown organization', async () => {
      organizations.findFirst.mockResolvedValue(null)

      await expect(service.createDraft(ORG, request())).rejects.toThrow(
        'Organization not found',
      )
    })
  })

  describe('schedule validation', () => {
    it('rejects a date inside the 2-business-day lead before resolving anything', async () => {
      await expect(
        service.createDraft(ORG, request({ scheduledLocalDate: '2026-09-23' })),
      ).rejects.toThrow('at least 2 business days')
      expect(texts.findOptedOutPersonIds).not.toHaveBeenCalled()
      expect(contacts.findContactsForFilter).not.toHaveBeenCalled()
    })

    it('rejects a weekend', async () => {
      await expect(
        service.createDraft(ORG, request({ scheduledLocalDate: '2026-09-26' })),
      ).rejects.toThrow('weekend')
    })

    it('rejects more than 30 days out', async () => {
      await expect(
        service.createDraft(ORG, request({ scheduledLocalDate: '2026-10-22' })),
      ).rejects.toThrow('more than 30 days')
    })

    it('accepts the first allowed day and the 30-day ceiling', async () => {
      expect(() =>
        assertServeSmsSendDateAllowed('2026-09-24', MONDAY_NOON_UTC),
      ).not.toThrow()
      expect(() =>
        assertServeSmsSendDateAllowed('2026-10-21', MONDAY_NOON_UTC),
      ).not.toThrow()
    })

    it('rejects a date that is not a real calendar day', async () => {
      await expect(
        service.createDraft(ORG, request({ scheduledLocalDate: '2026-02-30' })),
      ).rejects.toThrow('not a real calendar date')
    })

    it('rejects a malformed date', () => {
      expect(() => assertServeSmsSendDateAllowed('10/08/2026')).toThrow(
        'YYYY-MM-DD',
      )
    })

    // gp-api runs in UTC, which is a day ahead of the US for part of every
    // evening. Anchoring the window on the server's own clock would 400 the
    // earliest date the picker had just offered, so "today" is read in a
    // western US zone instead.
    it('does not out-run the picker when UTC has already rolled over', () => {
      // 19:00 Monday in Los Angeles, already Tuesday in UTC.
      const utcTuesdayPacificMonday = new Date('2026-09-22T02:00:00Z')

      expect(() =>
        assertServeSmsSendDateAllowed('2026-09-24', utcTuesdayPacificMonday),
      ).not.toThrow()
    })
  })

  // The audience helper is A3's and carries three circuit breakers. These pin
  // the two that a Serve create can actually reach (the recipient cap needs
  // 100k fixture rows), because the counts they guard are what gets charged —
  // and because the rest of this file's fixtures are single short pages that
  // never arm a breaker at all.
  describe('the audience helper’s guards, through createDraft', () => {
    it('still resolves a dedup-heavy list rather than rejecting it', async () => {
      contacts.findContactsForFilter
        // A full page of fresh numbers...
        .mockResolvedValueOnce({ people: people(AUDIENCE_PAGE_SIZE) })
        // ...then a full page that repeats every one of them. One such page is
        // legitimate: people-api's ordering clusters a household together.
        .mockResolvedValueOnce({
          people: repeatPhones(AUDIENCE_PAGE_SIZE, 'household'),
        })
        .mockResolvedValueOnce({ people: people(10, AUDIENCE_PAGE_SIZE) })

      const result = await service.createDraft(ORG, request())

      expect(result.recipientCount).toBe(AUDIENCE_PAGE_SIZE + 10)
      expect(result.excludedDuplicateCount).toBe(AUDIENCE_PAGE_SIZE)
      expect(prisma.outreach.create).toHaveBeenCalledOnce()
    })

    it('surfaces the stall guard rather than quoting a truncated audience', async () => {
      contacts.findContactsForFilter
        .mockResolvedValueOnce({ people: people(AUDIENCE_PAGE_SIZE) })
        .mockResolvedValueOnce({
          people: repeatPhones(AUDIENCE_PAGE_SIZE, 'a'),
        })
        .mockResolvedValueOnce({
          people: repeatPhones(AUDIENCE_PAGE_SIZE, 'b'),
        })
        .mockResolvedValueOnce({
          people: repeatPhones(AUDIENCE_PAGE_SIZE, 'c'),
        })
        .mockResolvedValue({ people: [] })

      await expect(service.createDraft(ORG, request())).rejects.toThrow(
        /consecutive full pages returned no phone/,
      )
      // Three stalled pages after the good one, then it aborts — it does not
      // read on to the scan ceiling.
      expect(contacts.findContactsForFilter).toHaveBeenCalledTimes(4)
      // The count never reaches pricing: no row, so nothing to check out.
      expect(prisma.outreach.create).not.toHaveBeenCalled()
    })
  })
})
