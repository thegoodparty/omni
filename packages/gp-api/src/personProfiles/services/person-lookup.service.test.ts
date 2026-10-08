import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { PersonLookupService } from './person-lookup.service'

const PERSON_ID = 'a1b2c3d4-0000-4000-8000-000000000000'
const SLUG = 'jordan-reyes-a1b2c3d4'

const person = (overrides = {}) => ({
  id: PERSON_ID,
  fullName: 'Jordan Reyes',
  firstName: 'Jordan',
  lastName: 'Reyes',
  state: 'CA',
  OfficeHolders: [
    { officeTitle: 'City Council Member', positionName: null, isCurrent: true },
  ],
  ...overrides,
})

describe('PersonLookupService', () => {
  let persons: {
    getPersonBySlug: ReturnType<typeof vi.fn>
    getContactEmail: ReturnType<typeof vi.fn>
    getPersons: ReturnType<typeof vi.fn>
  }
  let service: PersonLookupService
  let logSpy: {
    error: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    persons = {
      getPersonBySlug: vi.fn().mockResolvedValue(person()),
      getContactEmail: vi.fn(),
      getPersons: vi.fn(),
    }
    logSpy = { error: vi.fn(), warn: vi.fn() }
    const logger = {
      setContext: vi.fn(),
      ...logSpy,
    } as unknown as PinoLogger
    service = new PersonLookupService(
      persons as unknown as PersonsService,
      logger,
    )
  })

  it('returns the identity an operator needs to confirm the subject', async () => {
    const result = await service.lookup(SLUG)

    expect(result).toEqual({
      personId: PERSON_ID,
      fullName: 'Jordan Reyes',
      state: 'CA',
      office: 'City Council Member',
    })
  })

  // A privacy request quotes a URL, not a slug, and ops paste it verbatim in
  // whatever form it arrived.
  it.each([
    ['https://goodparty.org/people/jordan-reyes-a1b2c3d4'],
    ['https://goodparty.org/people/jordan-reyes-a1b2c3d4/'],
    ['https://goodparty.org/people/jordan-reyes-a1b2c3d4?utm_source=x'],
    ['/people/jordan-reyes-a1b2c3d4'],
    ['  jordan-reyes-a1b2c3d4  '],
  ])('extracts the slug from %s', async (query) => {
    await service.lookup(query)

    expect(persons.getPersonBySlug).toHaveBeenCalledWith(SLUG)
  })

  // The route validated the slug before querying, and a rejected slug came
  // back as "no match" rather than an outage. In process that guard is this
  // service's, so it has to hold the same line.
  it.each([['Jordan Reyes'], ['jordan_reyes'], ['../etc/passwd']])(
    'reports no match for the malformed slug %s without querying',
    async (query) => {
      expect(await service.lookup(query)).toBeNull()
      expect(persons.getPersonBySlug).not.toHaveBeenCalled()
    },
  )

  // The read hands back an election-db row rather than a narrow HTTP body, and
  // this response is rendered to an operator. Anything not named in the
  // response schema has to be dropped.
  it('drops columns the confirmation does not render', async () => {
    persons.getPersonBySlug.mockResolvedValue(
      person({ brDatabaseId: 99, updatedAt: new Date(), phone: '555-0100' }),
    )

    expect(Object.keys((await service.lookup(SLUG)) ?? {}).sort()).toEqual([
      'fullName',
      'office',
      'personId',
      'state',
    ])
  })

  it('prefers a current term when the person held several', async () => {
    persons.getPersonBySlug.mockResolvedValue(
      person({
        OfficeHolders: [
          { officeTitle: 'Trustee', positionName: null, isCurrent: false },
          { officeTitle: 'Mayor', positionName: null, isCurrent: true },
        ],
      }),
    )

    expect((await service.lookup(SLUG))?.office).toBe('Mayor')
  })

  it('falls back to first + last when fullName is unset', async () => {
    persons.getPersonBySlug.mockResolvedValue(person({ fullName: null }))

    expect((await service.lookup(SLUG))?.fullName).toBe('Jordan Reyes')
  })

  it('tolerates a person with no office terms', async () => {
    persons.getPersonBySlug.mockResolvedValue(person({ OfficeHolders: [] }))

    expect((await service.lookup(SLUG))?.office).toBeNull()
  })

  it('reports no match rather than an outage for an unknown slug', async () => {
    persons.getPersonBySlug.mockRejectedValue(
      new NotFoundException(`Person not found for slug=${SLUG}`),
    )

    expect(await service.lookup(SLUG)).toBeNull()
  })

  it('surfaces an election-db failure as a 502', async () => {
    persons.getPersonBySlug.mockRejectedValue(new Error('connection refused'))

    await expect(service.lookup(SLUG)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('never queries for an empty query', async () => {
    expect(await service.lookup('   ')).toBeNull()
    expect(persons.getPersonBySlug).not.toHaveBeenCalled()
  })

  describe('resolveIdentities', () => {
    const OTHER_ID = 'ffffffff-0000-4000-8000-000000000000'

    const batchOf = (people: object[]) => {
      persons.getPersons.mockResolvedValue(people)
    }

    it('builds the public /people URL the marketing site serves', async () => {
      batchOf([person({ slug: 'jordan-reyes' })])

      const identities = await service.resolveIdentities([PERSON_ID])

      // The 8-hex id suffix is what actually resolves the page — slugs are not
      // unique — so a URL missing it points at the wrong person or nobody.
      expect(identities.get(PERSON_ID)).toEqual({
        fullName: 'Jordan Reyes',
        profileUrl: `${process.env.WEBAPP_ROOT_URL}/people/jordan-reyes-a1b2c3d4`,
      })
    })

    it('asks for only the columns the log renders', async () => {
      batchOf([person({ slug: 'jordan-reyes' })])

      await service.resolveIdentities([PERSON_ID, OTHER_ID, PERSON_ID])

      expect(persons.getPersons).toHaveBeenCalledWith({
        // Deduped: a person can appear once per takedown record.
        ids: [PERSON_ID, OTHER_ID],
        columns: 'id,slug,fullName,firstName,lastName',
        includeOfficeHolders: false,
        includeCandidacies: false,
      })
    })

    it('leaves a person with no slug unlinkable rather than guessing a URL', async () => {
      batchOf([person({ slug: null })])

      expect(await service.resolveIdentities([PERSON_ID])).toEqual(
        new Map([[PERSON_ID, { fullName: 'Jordan Reyes', profileUrl: null }]]),
      )
    })

    it('returns what it has when the read fails', async () => {
      // The takedown log is the operator's only view of active removals;
      // failing it wholesale over a naming nicety would hide them.
      persons.getPersons.mockRejectedValue(new Error('connection refused'))

      expect(await service.resolveIdentities([PERSON_ID])).toEqual(new Map())
    })

    it('makes no call for an empty list', async () => {
      expect(await service.resolveIdentities([])).toEqual(new Map())
      expect(persons.getPersons).not.toHaveBeenCalled()
    })
  })

  describe('resolveContactEmail', () => {
    it('reads the dedicated PII accessor, not a general person read', async () => {
      persons.getContactEmail.mockResolvedValue({
        personId: PERSON_ID,
        email: 'mayor@city.gov',
      })

      expect(await service.resolveContactEmail(PERSON_ID)).toBe(
        'mayor@city.gov',
      )
      expect(persons.getContactEmail).toHaveBeenCalledWith(PERSON_ID)
      expect(persons.getPersons).not.toHaveBeenCalled()
    })

    // Every "we can't tell you" case collapses to null: the caller is a
    // detached CRM side-effect of a public form submission, so its only correct
    // response to any of these is to skip the event.
    it.each([
      [
        'no address on file',
        () => Promise.resolve({ personId: PERSON_ID, email: null }),
      ],
      [
        'a blank address',
        () => Promise.resolve({ personId: PERSON_ID, email: '   ' }),
      ],
      [
        'an unknown person',
        () => Promise.reject(new NotFoundException('Person not found')),
      ],
      ['an election-db outage', () => Promise.reject(new Error('boom'))],
    ])('returns null for %s', async (_case, response) => {
      persons.getContactEmail.mockImplementation(response)

      await expect(service.resolveContactEmail(PERSON_ID)).resolves.toBeNull()
    })

    it('keeps the address out of the log when the read fails', async () => {
      // This read's success value IS the address, so logging the error object
      // — which can carry the row that produced it — would put a candidate's
      // email in the logs. Only the message may be logged.
      const error: Error & { row?: unknown } = new Error('boom')
      error.row = { personId: PERSON_ID, email: 'mayor@city.gov' }
      persons.getContactEmail.mockRejectedValue(error)

      await expect(service.resolveContactEmail(PERSON_ID)).resolves.toBeNull()

      expect(logSpy.error).toHaveBeenCalledOnce()
      expect(JSON.stringify(logSpy.error.mock.calls[0])).not.toContain(
        'mayor@city.gov',
      )
    })
  })
})
