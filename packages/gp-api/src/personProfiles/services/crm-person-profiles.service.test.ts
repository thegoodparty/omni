import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { HubspotService } from '@/crm/hubspot.service'
import { PrismaService } from '@/prisma/prisma.service'
import { SegmentService } from '@/vendors/segment/segment.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ProfileClaimRequestSource } from '../../generated/prisma'
import { PERSON_PROFILES_DATABRICKS } from '../personProfiles.constants'
import { recordCompletionRequestContactGap } from '../observability/person-profiles.metrics'
import { CrmPersonProfilesService } from './crm-person-profiles.service'
import { PersonLookupService } from './person-lookup.service'

/**
 * The two CRM side-effects of the public "notify" form: the candidate-side
 * counter, and the Segment event their nudge email is sent off.
 *
 * HubSpot, Segment, and election-api are mocked throughout — no live API is
 * called from tests. What matters for the counter is that the write is a
 * COMPUTED TOTAL (so it is idempotent and self-healing rather than a lossy
 * read-modify-write increment) and that it only ever counts notify
 * submissions. What matters for the event is that it carries the subject's
 * email address, since that is the only key HubSpot can resolve the contact
 * by. What matters for both is that every failure mode is swallowed, so the
 * visitor's already-committed claim request is never affected.
 */

// The contact-gap counter is the only assertion here that needs the real
// module stubbed: every record* function is a no-op when OTel is disabled, as
// it is under test, so there is nothing to observe otherwise. It reports an
// irreversible side-effect (a CRM contact Segment is about to create, whose
// original-source attribution cannot be repaired later), which makes it worth
// pinning rather than trusting.
vi.mock('../observability/person-profiles.metrics', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../observability/person-profiles.metrics')
  >()),
  recordCompletionRequestContactGap: vi.fn(),
}))

const PERSON_ID = '11111111-1111-1111-1111-111111111111'
const CONTACT_ID = '987654321'
const CLAIM_REQUEST_ID = '22222222-2222-2222-2222-222222222222'
const PERSON_EMAIL = 'councilmember@example.gov'

type SetupOptions = {
  hubspotConfigured?: boolean
  count?: number
  contactRows?: Array<Record<string, unknown>>
  databricksConfigured?: boolean
  databricksError?: Error
  updateError?: Error
  personEmail?: string | null
  personEmailError?: Error
  trackError?: Error
}

const setup = async (options: SetupOptions = {}) => {
  const count = vi.fn().mockResolvedValue(options.count ?? 1)
  const prisma = { profileClaimRequest: { count } }

  const update = vi.fn(
    (_contactId: string, _body: { properties: Record<string, string> }) =>
      options.updateError
        ? Promise.reject(options.updateError)
        : Promise.resolve({ id: CONTACT_ID }),
  )
  const hubspot = {
    isConfigured: options.hubspotConfigured ?? true,
    client: { crm: { contacts: { basicApi: { update } } } },
  }

  const query = vi.fn((_sql: string) =>
    options.databricksError
      ? Promise.reject(options.databricksError)
      : Promise.resolve({
          columns: ['hs_contact_id'],
          rows: options.contactRows ?? [{ hs_contact_id: CONTACT_ID }],
        }),
  )
  const databricks = options.databricksConfigured === false ? null : { query }

  const resolveContactEmail = vi.fn(() =>
    options.personEmailError
      ? Promise.reject(options.personEmailError)
      : Promise.resolve(
          options.personEmail === undefined
            ? PERSON_EMAIL
            : options.personEmail,
        ),
  )
  const personLookup = { resolveContactEmail }

  const trackAnonymousEvent = vi.fn(
    (
      _anonymousId: string,
      _event: string,
      _properties: Record<string, unknown>,
      _userContext?: { email?: string },
      _messageId?: string,
    ) =>
      options.trackError
        ? Promise.reject(options.trackError)
        : Promise.resolve({}),
  )
  const segment = { trackAnonymousEvent }

  const moduleRef = await Test.createTestingModule({
    providers: [
      CrmPersonProfilesService,
      { provide: PrismaService, useValue: prisma },
      { provide: PinoLogger, useValue: createMockLogger() },
      { provide: HubspotService, useValue: hubspot },
      { provide: SegmentService, useValue: segment },
      { provide: PersonLookupService, useValue: personLookup },
      { provide: PERSON_PROFILES_DATABRICKS, useValue: databricks },
    ],
  }).compile()

  return {
    service: moduleRef.get(CrmPersonProfilesService),
    count,
    update,
    query,
    resolveContactEmail,
    trackAnonymousEvent,
  }
}

describe('CrmPersonProfilesService.syncClaimRequestCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes the person's notify total to their HubSpot contact", async () => {
    const { service, update } = await setup({ count: 3 })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).toHaveBeenCalledWith(CONTACT_ID, {
      properties: { candidate_profile_requests: '3' },
    })
  })

  it('counts only notify submissions, so an owner claim never inflates it', async () => {
    const { service, count } = await setup()

    await service.syncClaimRequestCount(PERSON_ID)

    expect(count).toHaveBeenCalledWith({
      where: { personId: PERSON_ID, source: ProfileClaimRequestSource.notify },
    })
  })

  it('writes the recomputed total, not an increment, so a retry is idempotent', async () => {
    const { service, update } = await setup({ count: 7 })

    await service.syncClaimRequestCount(PERSON_ID)
    await service.syncClaimRequestCount(PERSON_ID)

    // Same value both times: the source of truth is our own row count, so a
    // duplicate run cannot double-count the way a read-then-+1 would.
    expect(update.mock.calls.map(([, body]) => body)).toEqual([
      { properties: { candidate_profile_requests: '7' } },
      { properties: { candidate_profile_requests: '7' } },
    ])
  })

  it('resolves the contact by personId against the civics person mart', async () => {
    const { service, query } = await setup()

    await service.syncClaimRequestCount(PERSON_ID)

    const sql = query.mock.calls[0]?.[0] ?? ''
    expect(sql).toContain('goodparty_data_catalog.mart_civics.people')
    expect(sql).toContain(`gp_person_id = '${PERSON_ID}'`)
  })

  it('skips quietly when the person has no HubSpot contact', async () => {
    const { service, update } = await setup({ contactRows: [] })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).not.toHaveBeenCalled()
  })

  it('skips quietly when the mart resolves the person to a null contact id', async () => {
    // A person whose identity cluster spans more than one HubSpot contact is
    // nulled by the mart. Writing to an arbitrary one would be worse than
    // writing to none.
    const { service, update } = await setup({
      contactRows: [{ hs_contact_id: null }],
    })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).not.toHaveBeenCalled()
  })

  it('never creates a contact for a person the CRM has never seen', async () => {
    const { service, update } = await setup({ contactRows: [] })

    await service.syncClaimRequestCount(PERSON_ID)

    // A visitor nudging someone must not mint a CRM record for them.
    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing when HubSpot is unconfigured, rather than trusting the no-op mock', async () => {
    const { service, update, query } = await setup({
      hubspotConfigured: false,
    })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(query).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  // These three resolve with their outcome rather than throwing. Asserting the
  // value, not just the absence of a throw, is what keeps the contact-gap
  // metric honest: it reads this result, and only 'no_contact' may be read as
  // "the CRM has no contact for this person".
  it('is inert, not broken, when the warehouse is unconfigured', async () => {
    const { service, update } = await setup({ databricksConfigured: false })

    // Not 'no_contact': the mart was never asked, so nothing is known about
    // whether a contact exists.
    await expect(service.syncClaimRequestCount(PERSON_ID)).resolves.toBe(
      'unresolved',
    )
    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a warehouse failure', async () => {
    const { service, update } = await setup({
      databricksError: new Error('warehouse unavailable'),
    })

    await expect(service.syncClaimRequestCount(PERSON_ID)).resolves.toBe(
      'failed',
    )
    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a HubSpot failure so the visitor never sees it', async () => {
    const { service } = await setup({
      updateError: new Error('HubSpot 503'),
    })

    await expect(service.syncClaimRequestCount(PERSON_ID)).resolves.toBe(
      'failed',
    )
  })

  it('coerces a numeric contact id from the mart to the string HubSpot expects', async () => {
    const { service, update } = await setup({
      contactRows: [{ hs_contact_id: 987654321 }],
      count: 2,
    })

    await service.syncClaimRequestCount(PERSON_ID)

    expect(update).toHaveBeenCalledWith('987654321', {
      properties: { candidate_profile_requests: '2' },
    })
  })

  it('refuses to interpolate a personId that is not a UUID', async () => {
    const { service, query, update } = await setup()

    await service.syncClaimRequestCount("' OR 1=1 --")

    expect(query).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('CrmPersonProfilesService.handleNotifySubmitted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("puts the subject's email on the event, since it is the only key HubSpot can resolve the contact by", async () => {
    const { service, trackAnonymousEvent } = await setup()

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    // The address rides in context.traits, which is where the HubSpot
    // destination looks — not in the event properties.
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      PERSON_ID,
      EVENTS.PersonProfiles.CompletionRequested,
      { personId: PERSON_ID, claimRequestId: CLAIM_REQUEST_ID },
      { email: PERSON_EMAIL },
      CLAIM_REQUEST_ID,
    )
  })

  it('keys the event to the person, not the submission, so repeat nudges share one profile', async () => {
    const { service, trackAnonymousEvent } = await setup()

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)
    await service.handleNotifySubmitted(PERSON_ID, 'a-second-request')

    const anonymousIds = trackAnonymousEvent.mock.calls.map(([id]) => id)
    expect(anonymousIds).toEqual([PERSON_ID, PERSON_ID])
  })

  it('dedups a replay to one email by passing the claim request id as the messageId', async () => {
    const { service, trackAnonymousEvent } = await setup()

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)
    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    const messageIds = trackAnonymousEvent.mock.calls.map(([, , , , id]) => id)
    expect(messageIds).toEqual([CLAIM_REQUEST_ID, CLAIM_REQUEST_ID])
  })

  it('sends nothing when the person has no email on record', async () => {
    // An unroutable event cannot become an email; it would only leave an
    // orphan record in the CRM.
    const { service, trackAnonymousEvent } = await setup({ personEmail: null })

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    expect(trackAnonymousEvent).not.toHaveBeenCalled()
  })

  it('still refreshes the count when the event cannot be sent', async () => {
    const { service, update } = await setup({ count: 4, personEmail: null })

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    expect(update).toHaveBeenCalledWith(CONTACT_ID, {
      properties: { candidate_profile_requests: '4' },
    })
  })

  it('still sends the event when the count write fails', async () => {
    // The two halves resolve the contact by different keys and reach HubSpot by
    // different routes, so neither may take the other down.
    const { service, trackAnonymousEvent } = await setup({
      updateError: new Error('HubSpot 503'),
    })

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    expect(trackAnonymousEvent).toHaveBeenCalledOnce()
  })

  it('swallows a Segment failure so the visitor never sees it', async () => {
    const { service } = await setup({ trackError: new Error('Segment 500') })

    await expect(
      service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID),
    ).resolves.toBeUndefined()
  })

  it('swallows an election-api failure so the visitor never sees it', async () => {
    // resolveContactEmail returns null rather than throwing by contract, but a
    // throw must not escape here either.
    const { service, trackAnonymousEvent } = await setup({
      personEmailError: new Error('election-api down'),
    })

    await expect(
      service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID),
    ).resolves.toBeUndefined()
    expect(trackAnonymousEvent).not.toHaveBeenCalled()
  })
})

/**
 * The count of contacts this feature causes Segment to create.
 *
 * Neither half can see this alone: the counter half knows whether HubSpot held
 * a contact, the event half knows whether an address existed, and it is the
 * combination — address but no contact — that means the cloud-mode destination
 * is about to create one and fix its original source to "offline sources"
 * forever. Accepted, but it has to be countable, because it is the one cost
 * here that cannot be undone after the fact.
 */
describe('CrmPersonProfilesService.handleNotifySubmitted contact-gap metric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records new_contact when the event goes out for someone the CRM has never seen', async () => {
    const { service } = await setup({ contactRows: [] })

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    expect(recordCompletionRequestContactGap).toHaveBeenCalledWith(
      'new_contact',
    )
  })

  it('records existing_contact when the subject already had one', async () => {
    const { service } = await setup()

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    expect(recordCompletionRequestContactGap).toHaveBeenCalledWith(
      'existing_contact',
    )
  })

  it.each([
    ['HubSpot is unconfigured', { hubspotConfigured: false }],
    ['the warehouse lookup failed', { databricksError: new Error('boom') }],
    ['the warehouse is unconfigured', { databricksConfigured: false }],
  ])('records unknown when %s', async (_case, options) => {
    // Contact status was never established, so neither bucket would be a fact.
    const { service } = await setup(options)

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    expect(recordCompletionRequestContactGap).toHaveBeenCalledWith('unknown')
  })

  it.each([
    ['no address was on file', { personEmail: null }],
    ['Segment rejected the event', { trackError: new Error('Segment 500') }],
  ])('records nothing when %s', async (_case, options) => {
    // No event means nothing reached the CRM, so nothing can have been created
    // there — recording a gap would overstate the cost.
    const { service } = await setup({ ...options, contactRows: [] })

    await service.handleNotifySubmitted(PERSON_ID, CLAIM_REQUEST_ID)

    expect(recordCompletionRequestContactGap).not.toHaveBeenCalled()
  })
})
