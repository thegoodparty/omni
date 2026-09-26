import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
  CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
  Person,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { ConstituentFeedbackExtractionService } from '../services/constituentFeedbackExtraction.service'

const service = useTestService()

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

const PEOPLE_PAGINATION = {
  totalResults: 0,
  currentPage: 1,
  pageSize: 1000,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const fakePerson = (overrides: Partial<Person> = {}): Person => ({
  id: randomUUID(),
  lalVoterId: `LAL-${randomUUID()}`,
  firstName: 'Rosa',
  middleName: null,
  lastName: 'Constituent',
  nameSuffix: null,
  age: 44,
  state: 'WY',
  address: {
    line1: '12 Elm St',
    line2: null,
    city: 'Cheyenne',
    state: 'WY',
    zip: '82001',
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: '3075550101',
  landline: null,
  gender: null,
  politicalParty: 'Independent',
  registeredVoter: 'Yes',
  estimatedIncomeAmount: null,
  voterStatus: null,
  maritalStatus: null,
  hasChildrenUnder18: null,
  veteranStatus: null,
  homeowner: null,
  businessOwner: null,
  levelOfEducation: null,
  ethnicityGroup: null,
  language: 'English',
  ...overrides,
})

// The triple the model is pretending to return. Each test sets it before the
// capture it wants to shape.
let extraction = {
  issueLabel: 'Compost collection' as string | null,
  stance: 'mixed' as string | null,
  desiredOutcome: 'Weekly pickup' as string | null,
  confidence: 0.8 as number | null,
}

describe('constituent feedback routes', () => {
  let eoSlug: string
  let listId: number
  let entryId: number
  let personId: string

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    eoSlug = `eo-cf-${suffix}`
    extraction = {
      issueLabel: 'Compost collection',
      stance: 'mixed',
      desiredOutcome: 'Weekly pickup',
      confidence: 0.8,
    }

    vi.spyOn(
      service.app.get(ConstituentFeedbackExtractionService),
      'extract',
    ).mockImplementation(async () => ({
      extraction: { ...extraction },
      model: 'claude-test',
    }))

    await service.prisma.organization.create({
      data: {
        slug: eoSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: eoSlug },
    })
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: eoSlug, name: 'Constituents' },
    })

    const person = fakePerson()
    personId = person.id
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockResolvedValue({ pagination: PEOPLE_PAGINATION, people: [person] })

    const created = await service.client.post(
      '/v1/phone-banking/serve/lists',
      {
        name: 'Compost calls',
        script: 'Calling about the compost pilot.',
        sheetCount: 1,
        voterFileFilterId: filter.id,
        purpose: 'community_input',
        communityInputQuestion: 'Would you take part in a compost pilot?',
      },
      { headers: { 'x-organization-slug': eoSlug } },
    )
    expect(created.status).toBe(201)
    listId = created.data.id

    const entry = await service.prisma.phoneBankingListEntry.findFirstOrThrow({
      where: { phoneBankingListId: listId },
    })
    entryId = entry.id

    const call = await service.client.post(
      `/v1/phone-banking/lists/${listId}/calls`,
      {
        entryId,
        outcome: 'answered',
        personId,
        followUp: 'yes',
      },
      { headers: { 'x-organization-slug': eoSlug } },
    )
    expect(call.status).toBe(201)
  })

  // A function, not a const: `eoSlug` is assigned in beforeEach, and a
  // const here would capture the undefined it holds while describe runs.
  const headers = () => ({ headers: { 'x-organization-slug': eoSlug } })

  const capture = (transcript: string, clientKey = randomUUID()) =>
    service.client.post(
      '/v1/constituent-feedback',
      {
        channel: 'phone_bank',
        entryId,
        personId,
        clientKey,
        transcript,
        captureMethod: 'dictation',
      },
      { ...headers(), validateStatus: () => true },
    )

  it('captures a memo and hands back what the model proposed', async () => {
    const res = await capture('Rosa wants weekly compost pickup.')

    expect(res.status).toBe(201)
    expect(res.data.extractionStatus).toBe('extracted')
    expect(res.data.extraction).toEqual({
      issueLabel: 'Compost collection',
      stance: 'mixed',
      desiredOutcome: 'Weekly pickup',
    })
  })

  // A re-record REPLACES the triple, so the confirmation the old one earned
  // is void. Leaving `confirmedAt` set would hand reporting a model guess
  // wearing a human's signature.
  it('clears a prior confirmation when the memo is re-recorded', async () => {
    const first = await capture('Rosa wants weekly compost pickup.')
    const id = first.data.id

    const confirmed = await service.client.patch(
      `/v1/constituent-feedback/${id}/confirm`,
      {
        issueLabel: 'Compost collection',
        stance: 'supports',
        desiredOutcome: 'Weekly pickup',
      },
      headers(),
    )
    expect(confirmed.status).toBe(200)
    expect(confirmed.data.confirmedAt).not.toBeNull()

    extraction = {
      issueLabel: 'Rodents',
      stance: 'opposes',
      desiredOutcome: 'Sealed bins',
      confidence: 0.6,
    }
    const second = await capture('Actually it was about the rats.')
    expect(second.status).toBe(201)

    const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
      where: { id },
    })
    expect(row.confirmedAt).toBeNull()
    expect(row.issueLabel).toBe('Rodents')
  })

  // The client cannot be relied on to re-send the same replay key: the phone
  // panel keys its form on personId, so a tab switch mints a fresh uuid. One
  // memo per interaction is the real invariant, so a fresh key must update
  // the existing row rather than collide on `phoneBankingInteractionId`.
  it('re-records onto the same row even under a fresh replay key', async () => {
    const first = await capture('First take.')
    expect(first.status).toBe(201)

    const second = await capture('Second take.', randomUUID())

    expect(second.status).toBe(201)
    expect(second.data.id).toBe(first.data.id)

    const rows = await service.prisma.constituentFeedback.findMany({
      where: { organizationSlug: eoSlug },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.transcript).toBe('Second take.')
  })

  // The model is told to answer short and nearly always does, but nothing
  // makes it. The response schema caps these two, and the interceptor
  // enforces that cap on the way out — so an unclamped overlong string would
  // save the row and then 500 the request that saved it, leaving the caller
  // looking at a failure for a memo that is safely on disk.
  it('keeps an overlong proposal instead of failing the capture', async () => {
    extraction = {
      issueLabel: 'x'.repeat(CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH + 50),
      stance: 'mixed',
      desiredOutcome: 'y'.repeat(
        CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH + 500,
      ),
      confidence: 0.5,
    }

    const res = await capture('A very long answer.')

    expect(res.status).toBe(201)
    expect(res.data.extraction?.issueLabel).toHaveLength(
      CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
    )
    expect(res.data.extraction?.desiredOutcome).toHaveLength(
      CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
    )
  })

  it('lists a person’s feedback for the org that recorded it', async () => {
    await capture('Rosa wants weekly compost pickup.')

    const res = await service.client.get('/v1/constituent-feedback', {
      ...headers(),
      params: { personId },
    })

    expect(res.status).toBe(200)
    expect(res.data.feedback).toHaveLength(1)
    expect(res.data.feedback[0]?.issueLabel).toBe('Compost collection')
  })
})
