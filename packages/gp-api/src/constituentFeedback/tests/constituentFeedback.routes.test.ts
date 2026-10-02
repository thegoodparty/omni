import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
  CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
  Person,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  DoorKnockOutcome,
  DoorKnockingMode,
  OrganizationRole,
  OutreachType,
} from '@/generated/prisma'
import type { GeoJsonPolygon } from '@goodparty_org/contracts'
import { FeaturesService } from '@/features/services/features.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { ConstituentFeedbackExtractionService } from '../services/constituentFeedbackExtraction.service'

const service = useTestService()

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

const GEO_POLY: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-87.66, 41.89],
      [-87.64, 41.89],
      [-87.65, 41.91],
      [-87.66, 41.89],
    ],
  ],
}

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

// Locally and in tests every flag reads as on (the placeholder key), so a test
// about WHICH flag gates a request has to say which ones are on itself.
const onlyFlagOn = (flag: string) => {
  const spy = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockImplementation(async ({ feature }) => feature === flag)
  onTestFinished(() => spy.mockRestore())
  return spy
}

const flagsAskedFor = (spy: ReturnType<typeof onlyFlagOn>) =>
  spy.mock.calls.map(([params]) => params.feature)

const createVolunteer = async (slug: string) => {
  const label = `cf-volunteer-${randomUUID()}`
  const user = await service.prisma.user.create({
    data: { email: `${label}@example.com`, clerkId: `user_${label}` },
  })
  await service.prisma.organizationMembership.create({
    data: {
      organizationSlug: slug,
      userId: user.id,
      role: OrganizationRole.volunteer,
    },
  })
  const token = jwt.sign({ sub: `user_${label}` }, process.env.AUTH_SECRET!, {
    expiresIn: '1h',
  })
  return {
    user,
    config: {
      headers: {
        'x-organization-slug': slug,
        Authorization: `Bearer ${token}`,
      },
      validateStatus: () => true,
    },
  }
}

const assign = (slug: string, outreachId: number, assigneeUserId: number) =>
  service.prisma.outreachAssignment.create({
    data: { organizationSlug: slug, outreachId, assigneeUserId },
  })

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

  // The envelope is the one key an effort has on both channels. Filing the
  // memo under it at capture is what lets a report scope to one list without
  // walking back through the call row.
  it('files a phone-bank memo under its list’s outreach envelope', async () => {
    const res = await capture('Rosa wants weekly compost pickup.')
    expect(res.status).toBe(201)

    const envelope = await service.prisma.outreach.findUniqueOrThrow({
      where: { phoneBankingListId: listId },
    })
    const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
      where: { id: res.data.id },
    })
    expect(row.outreachId).toBe(envelope.id)
  })

  // A Win list made without a Campaign row is written with no envelope. What
  // the person said is still worth keeping; it just has no effort to sit under.
  it('captures against a list with no envelope, unlinked', async () => {
    await service.prisma.outreach.delete({
      where: { phoneBankingListId: listId },
    })

    const res = await capture('Rosa wants weekly compost pickup.')

    expect(res.status).toBe(201)
    const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
      where: { id: res.data.id },
    })
    expect(row.outreachId).toBeNull()
  })

  // Rows written before the link existed carry none. A re-record resolves the
  // effort again, so it files such a row on the way through.
  it('files a re-recorded memo under its envelope', async () => {
    const first = await capture('First take.')
    expect(first.status).toBe(201)
    await service.prisma.constituentFeedback.update({
      where: { id: first.data.id },
      data: { outreachId: null },
    })

    const second = await capture('Second take.')
    expect(second.status).toBe(201)

    const envelope = await service.prisma.outreach.findUniqueOrThrow({
      where: { phoneBankingListId: listId },
    })
    const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
      where: { id: first.data.id },
    })
    expect(row.outreachId).toBe(envelope.id)
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
    const envelope = await service.prisma.outreach.findUniqueOrThrow({
      where: { phoneBankingListId: listId },
    })
    expect(res.data.feedback[0]?.outreachId).toBe(envelope.id)
  })

  // The question is denormalized onto the row precisely because the effort's
  // own copy can be edited later. `extract()` always reads the current one, so
  // a stale copy here would leave the row claiming a prompt nothing ran with.
  it('re-reads the effort question when the memo is re-recorded', async () => {
    const first = await capture('Rosa wants weekly compost pickup.')
    expect(first.status).toBe(201)

    await service.prisma.phoneBankingList.update({
      where: { id: listId },
      data: { communityInputQuestion: 'Should we expand the compost pilot?' },
    })

    const second = await capture('Still about compost, but the wider pilot.')
    expect(second.status).toBe(201)

    const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
      where: { id: first.data.id },
    })
    expect(row.effortQuestion).toBe('Should we expand the compost pilot?')
  })

  // The phone arm's own scope, mirroring the door's. `resolvePhoneBankCall`
  // finds the entry through `list: { organizationSlug }`; without it, another
  // org's entry resolves and its call is written into this org's record.
  it('refuses an entry from another org', async () => {
    const otherSlug = `eo-pbother-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
    await service.prisma.organization.create({
      data: {
        slug: otherSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: otherSlug },
    })
    const otherFilter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: otherSlug, name: 'Their constituents' },
    })

    // The SAME person, called on both orgs' lists. Anything less and the
    // interaction lookup would do the rejecting and the org scope would never
    // be reached — the mistake the door's version of this test started with.
    const theirList = await service.client.post(
      '/v1/phone-banking/serve/lists',
      {
        name: 'Their calls',
        script: 'Calling from another office.',
        sheetCount: 1,
        voterFileFilterId: otherFilter.id,
        purpose: 'community_input',
        communityInputQuestion: 'Theirs, and private',
      },
      { headers: { 'x-organization-slug': otherSlug } },
    )
    expect(theirList.status).toBe(201)

    const theirEntry =
      await service.prisma.phoneBankingListEntry.findFirstOrThrow({
        where: { phoneBankingListId: theirList.data.id },
      })
    const theirCall = await service.client.post(
      `/v1/phone-banking/lists/${theirList.data.id}/calls`,
      {
        entryId: theirEntry.id,
        outcome: 'answered',
        personId,
        followUp: 'yes',
      },
      { headers: { 'x-organization-slug': otherSlug } },
    )
    expect(theirCall.status).toBe(201)

    const res = await service.client.post(
      '/v1/constituent-feedback',
      {
        channel: 'phone_bank',
        entryId: theirEntry.id,
        personId,
        clientKey: randomUUID(),
        transcript: 'Should not be readable from here.',
        captureMethod: 'dictation',
      },
      { ...headers(), validateStatus: () => true },
    )

    expect(res.status).toBe(404)
    const rows = await service.prisma.constituentFeedback.findMany({
      where: { organizationSlug: eoSlug },
    })
    expect(rows).toHaveLength(0)
  })

  // A volunteer reaches a call only through an assignment on its effort, and a
  // list with no envelope has no effort to be assigned to.
  it('refuses a volunteer a call that belongs to no effort', async () => {
    await service.prisma.outreach.delete({
      where: { phoneBankingListId: listId },
    })
    const volunteer = await createVolunteer(eoSlug)

    const res = await service.client.post(
      '/v1/constituent-feedback',
      {
        channel: 'phone_bank',
        entryId,
        personId,
        clientKey: randomUUID(),
        transcript: 'Rosa wants weekly compost pickup.',
        captureMethod: 'dictation',
      },
      volunteer.config,
    )

    expect(res.status).toBe(404)
    const rows = await service.prisma.constituentFeedback.findMany({
      where: { organizationSlug: eoSlug },
    })
    expect(rows).toHaveLength(0)
  })

  // Each product rolls out on its own flag. A Serve org is gated on
  // serve-issue-capture alone, so turning Win's on cannot open it.
  describe('the Serve rollout flag', () => {
    it('admits a Serve org when serve-issue-capture is on', async () => {
      const flags = onlyFlagOn('serve-issue-capture')

      const res = await capture('Rosa wants weekly compost pickup.')

      expect(res.status).toBe(201)
      expect(flagsAskedFor(flags)).toEqual(['serve-issue-capture'])
    })

    it('404s a Serve org when only win-issue-capture is on', async () => {
      onlyFlagOn('win-issue-capture')

      const res = await capture('Rosa wants weekly compost pickup.')

      expect(res.status).toBe(404)
    })
  })

  // The door arm files the memo under the knock row's own envelope and reads
  // the question from that envelope's turf, falling back to the stop target's
  // turf for a knock written before the row kept its envelope. The stop
  // target lookup is scoped by `stop.turf.voterFileFilter.organizationSlug`,
  // so another org's stop target never resolves and its question never
  // reaches this org's record.
  describe('the door-knock channel', () => {
    // Builds a turf carrying `question`, one stop with one target on it, and
    // a knock recorded against a fresh client key.
    const seedKnock = async (
      orgSlug: string,
      question: string | null,
      // Shared deliberately by the cross-org case: `resolveKnock` also
      // filters on the knock's own personId, so two orgs holding DIFFERENT
      // people would be rejected by that filter and the org scope would
      // never be exercised at all.
      knockPersonId = randomUUID(),
    ) => {
      const filter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: orgSlug, name: `audience ${orgSlug}` },
      })
      const turf = await service.prisma.doorKnockingTurf.create({
        data: {
          voterFileFilterId: filter.id,
          name: 'Turf A',
          color: '#ff0000',
          geoPoly: GEO_POLY,
          ...(question === null ? {} : { communityInputQuestion: question }),
        },
      })
      const envelope = await service.prisma.outreach.create({
        data: {
          organizationSlug: orgSlug,
          outreachType: OutreachType.nativeDoorKnocking,
          doorKnockingTurfId: turf.id,
        },
      })
      await service.prisma.doorKnockingRoute.create({
        data: {
          doorKnockingTurfId: turf.id,
          mode: DoorKnockingMode.walk,
          loop: false,
          totalSeconds: 100,
          totalMeters: 100,
          credits: 1,
        },
      })
      const stop = await service.prisma.doorKnockingStop.create({
        data: {
          doorKnockingTurfId: turf.id,
          seq: 1,
          lat: 0,
          lng: 0,
          displayAddress: '123 Main St',
          legSeconds: 1,
          legMeters: 1,
        },
      })
      const target = await service.prisma.doorKnockingStopTarget.create({
        data: {
          doorKnockingStopId: stop.id,
          personId: knockPersonId,
          addressKey: 'key-1',
          name: 'Dorian Fen',
        },
      })
      const knockClientKey = randomUUID()
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: orgSlug,
          personId: knockPersonId,
          occurredAt: new Date(),
          outcome: DoorKnockOutcome.answered,
          sourceId: knockClientKey,
          actorUserId: service.user.id,
        },
      })
      return {
        knockClientKey,
        stopTargetId: target.id,
        knockPersonId,
        outreachId: envelope.id,
      }
    }

    const captureKnock = (
      body: { knockClientKey: string; stopTargetId: number },
      slug = eoSlug,
    ) =>
      service.client.post(
        '/v1/constituent-feedback',
        {
          channel: 'door_knock',
          knockClientKey: body.knockClientKey,
          stopTargetId: body.stopTargetId,
          clientKey: body.knockClientKey,
          transcript: 'Dorian is against the cameras.',
          captureMethod: 'dictation',
        },
        {
          headers: { 'x-organization-slug': slug },
          validateStatus: () => true,
        },
      )

    it('captures a memo against the knock and its turf question', async () => {
      const seeded = await seedKnock(eoSlug, 'How do you feel about compost?')

      const res = await captureKnock(seeded)

      expect(res.status).toBe(201)
      expect(res.data.personId).toBe(seeded.knockPersonId)
      expect(res.data.extraction).toEqual({
        issueLabel: 'Compost collection',
        stance: 'mixed',
        desiredOutcome: 'Weekly pickup',
      })

      const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
        where: { id: res.data.id },
      })
      expect(row.channel).toBe('door_knock')
      expect(row.doorKnockInteractionId).not.toBeNull()
      expect(row.phoneBankingInteractionId).toBeNull()
      // Denormalized off the turf, so a later edit cannot rewrite the prompt
      // this extraction actually ran against.
      expect(row.effortQuestion).toBe('How do you feel about compost?')
    })

    it('files a knock memo under its turf’s outreach envelope', async () => {
      const seeded = await seedKnock(eoSlug, 'How do you feel about compost?')

      const res = await captureKnock(seeded)

      expect(res.status).toBe(201)
      const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
        where: { id: res.data.id },
      })
      expect(row.outreachId).toBe(seeded.outreachId)
    })

    // Every turf is created with an envelope, and the knock route already
    // refuses a turf without one. A memo here would be an effort-less row on
    // a channel where that cannot legitimately happen.
    it('refuses a knock on a turf with no envelope', async () => {
      const seeded = await seedKnock(eoSlug, 'Mine')
      await service.prisma.outreach.delete({
        where: { id: seeded.outreachId },
      })

      const res = await captureKnock(seeded)

      expect(res.status).toBe(404)
      const rows = await service.prisma.constituentFeedback.findMany({
        where: { organizationSlug: eoSlug },
      })
      expect(rows).toHaveLength(0)
    })

    // The gate. A stop target belonging to another org's turf must not
    // resolve, or that org's `communityInputQuestion` would be pulled into
    // this org's record along with it.
    it('refuses a stop target from another org', async () => {
      const mine = await seedKnock(eoSlug, 'Mine')

      const otherSlug = `eo-other-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
      await service.prisma.organization.create({
        data: {
          slug: otherSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      // The same constituent on both orgs' turfs, which is the case the org
      // scope exists for: every other filter in the query passes here.
      const theirs = await seedKnock(
        otherSlug,
        'Theirs, and private',
        mine.knockPersonId,
      )

      const res = await captureKnock({
        knockClientKey: mine.knockClientKey,
        stopTargetId: theirs.stopTargetId,
      })

      expect(res.status).toBe(404)
      const rows = await service.prisma.constituentFeedback.findMany({
        where: { organizationSlug: eoSlug },
      })
      expect(rows).toHaveLength(0)
    })

    it('refuses a knock this org never recorded', async () => {
      const seeded = await seedKnock(eoSlug, 'Mine')

      const res = await captureKnock({
        knockClientKey: randomUUID(),
        stopTargetId: seeded.stopTargetId,
      })

      expect(res.status).toBe(404)
    })

    // A turf with no question still captures: the memo is the record worth
    // keeping, and the question is context the extraction can do without.
    it('captures against a turf that asks nothing', async () => {
      const seeded = await seedKnock(eoSlug, null)

      const res = await captureKnock(seeded)

      expect(res.status).toBe(201)
      const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
        where: { id: res.data.id },
      })
      expect(row.effortQuestion).toBeNull()
    })

    // The knock row carries the envelope it was written under, resolved
    // server-side from its own stop target. `stopTargetId` on the memo is
    // whatever the client sent, and a person can sit in two turfs, so the
    // knock's own envelope is the one the memo belongs to.
    it('files the memo under the knock’s own envelope over the stop target’s', async () => {
      const seeded = await seedKnock(eoSlug, 'The stop target’s question')
      const other = await seedKnock(eoSlug, 'The knock’s own question')
      await service.prisma.contactInteractionDoorKnock.update({
        where: {
          organizationSlug_sourceId: {
            organizationSlug: eoSlug,
            sourceId: seeded.knockClientKey,
          },
        },
        data: { outreachId: other.outreachId },
      })

      const res = await captureKnock(seeded)

      expect(res.status).toBe(201)
      const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
        where: { id: res.data.id },
      })
      expect(row.outreachId).toBe(other.outreachId)
      expect(row.effortQuestion).toBe('The knock’s own question')
    })

    // The same module serves a candidate's campaign org. Which product a
    // request belongs to is read off the slug, as every other Win/Serve split
    // in gp-api reads it, and it decides which rollout flag gates the request.
    describe('on a Win campaign org', () => {
      let winSlug: string

      beforeEach(async () => {
        winSlug = `campaign-cf-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`
        await service.prisma.organization.create({
          data: {
            slug: winSlug,
            ownerId: service.user.id,
            overrideDistrictId: DISTRICT_ID,
          },
        })
        await service.prisma.campaign.create({
          data: {
            userId: service.user.id,
            slug: winSlug,
            organizationSlug: winSlug,
            isPro: true,
          },
        })
      })

      const ownerHeaders = () => ({
        headers: { 'x-organization-slug': winSlug },
        validateStatus: () => true,
      })

      const knockMemoBody = (knock: {
        knockClientKey: string
        stopTargetId: number
      }) => ({
        channel: 'door_knock',
        knockClientKey: knock.knockClientKey,
        stopTargetId: knock.stopTargetId,
        clientKey: knock.knockClientKey,
        transcript: 'She wants the bond spent on the roads.',
        captureMethod: 'dictation',
      })

      const CONFIRMED = {
        issueLabel: 'Road bond',
        stance: 'supports',
        desiredOutcome: 'Spend it on the roads',
      }

      it('records and confirms a memo for the candidate', async () => {
        const seeded = await seedKnock(
          winSlug,
          'How do you feel about the bond?',
        )

        const res = await service.client.post(
          '/v1/constituent-feedback',
          knockMemoBody(seeded),
          ownerHeaders(),
        )
        expect(res.status).toBe(201)

        const confirmed = await service.client.patch(
          `/v1/constituent-feedback/${res.data.id}/confirm`,
          CONFIRMED,
          ownerHeaders(),
        )
        expect(confirmed.status).toBe(200)
        expect(confirmed.data.confirmedAt).not.toBeNull()
        expect(confirmed.data.outreachId).toBe(seeded.outreachId)
      })

      // A volunteer is who walks most Win turfs, so the two writes carry
      // @AllowVolunteer(), like the knock route they follow, and the same
      // assignment rule: only on an effort they were handed.
      it('lets an assigned volunteer record and confirm a memo', async () => {
        const volunteer = await createVolunteer(winSlug)
        const seeded = await seedKnock(winSlug, null)
        await assign(winSlug, seeded.outreachId, volunteer.user.id)

        const res = await service.client.post(
          '/v1/constituent-feedback',
          knockMemoBody(seeded),
          volunteer.config,
        )
        expect(res.status).toBe(201)
        const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
          where: { id: res.data.id },
        })
        expect(row.actorUserId).toBe(volunteer.user.id)

        const confirmed = await service.client.patch(
          `/v1/constituent-feedback/${res.data.id}/confirm`,
          CONFIRMED,
          volunteer.config,
        )
        expect(confirmed.status).toBe(200)
      })

      // 404 rather than 403, as on the knock route: a volunteer probing a
      // teammate's turf learns nothing about whether it exists.
      it('refuses a volunteer not assigned to the effort on both writes', async () => {
        const volunteer = await createVolunteer(winSlug)
        const seeded = await seedKnock(winSlug, null)
        const recorded = await service.client.post(
          '/v1/constituent-feedback',
          knockMemoBody(seeded),
          ownerHeaders(),
        )
        expect(recorded.status).toBe(201)

        const captured = await service.client.post(
          '/v1/constituent-feedback',
          { ...knockMemoBody(seeded), transcript: 'Not my turf.' },
          volunteer.config,
        )
        const confirmed = await service.client.patch(
          `/v1/constituent-feedback/${recorded.data.id}/confirm`,
          CONFIRMED,
          volunteer.config,
        )

        expect(captured.status).toBe(404)
        expect(confirmed.status).toBe(404)
        const row = await service.prisma.constituentFeedback.findUniqueOrThrow({
          where: { id: recorded.data.id },
        })
        expect(row.transcript).toBe('She wants the bond spent on the roads.')
        expect(row.confirmedAt).toBeNull()
      })

      // Reading a person's memos is reading the CRM, which stays manager+.
      it('refuses a volunteer the person read', async () => {
        const volunteer = await createVolunteer(winSlug)
        const seeded = await seedKnock(winSlug, null)

        const res = await service.client.get('/v1/constituent-feedback', {
          ...volunteer.config,
          params: { personId: seeded.knockPersonId },
        })

        expect(res.status).toBe(403)
      })

      it('gates a Win org on win-issue-capture alone', async () => {
        const flags = onlyFlagOn('win-issue-capture')
        const volunteer = await createVolunteer(winSlug)
        const seeded = await seedKnock(winSlug, null)
        await assign(winSlug, seeded.outreachId, volunteer.user.id)

        const res = await service.client.post(
          '/v1/constituent-feedback',
          knockMemoBody(seeded),
          volunteer.config,
        )
        expect(res.status).toBe(201)
        const confirmed = await service.client.patch(
          `/v1/constituent-feedback/${res.data.id}/confirm`,
          CONFIRMED,
          volunteer.config,
        )
        expect(confirmed.status).toBe(200)

        expect(flagsAskedFor(flags)).toEqual([
          'win-issue-capture',
          'win-issue-capture',
        ])
      })

      it('404s a Win org when only serve-issue-capture is on', async () => {
        onlyFlagOn('serve-issue-capture')
        const seeded = await seedKnock(winSlug, null)

        const res = await service.client.post(
          '/v1/constituent-feedback',
          knockMemoBody(seeded),
          ownerHeaders(),
        )

        expect(res.status).toBe(404)
      })
    })
  })
})
