import { randomUUID } from 'node:crypto'
import type { GeoJsonPolygon } from '@goodparty_org/contracts'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
  ConstituentFeedbackStance,
  DoorKnockOutcome,
  DoorKnockingMode,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  PhoneBankingPurpose,
} from '@/generated/prisma'
import type { TestServiceContext } from '@/test-service'

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

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const createServeOrg = async (service: TestServiceContext) => {
  const slug = `eo-syn-${suffix()}`
  await service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: DISTRICT_ID,
    },
  })
  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: slug },
  })
  return slug
}

export const createWinOrg = async (service: TestServiceContext) => {
  const slug = `campaign-syn-${suffix()}`
  await service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: DISTRICT_ID,
    },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      isPro: true,
    },
  })
  return { slug, campaignId: campaign.id }
}

export type StopTarget = { id: number; personId: string }

// A turf with its envelope, one stop, and one stop target per person.
export const seedTurfEffort = async (
  service: TestServiceContext,
  slug: string,
  options: { question?: string | null; people?: number } = {},
) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: slug, name: `audience ${suffix()}` },
  })
  const turf = await service.prisma.doorKnockingTurf.create({
    data: {
      voterFileFilterId: filter.id,
      name: 'Turf A',
      color: '#ff0000',
      geoPoly: GEO_POLY,
      communityInputQuestion: options.question ?? null,
    },
  })
  const envelope = await service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType: OutreachType.nativeDoorKnocking,
      status: OutreachStatus.in_progress,
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
  const targets: StopTarget[] = []
  for (let i = 0; i < (options.people ?? 6); i++) {
    const target = await service.prisma.doorKnockingStopTarget.create({
      data: {
        doorKnockingStopId: stop.id,
        personId: randomUUID(),
        addressKey: `key-${i}`,
        name: `Resident ${i}`,
      },
    })
    targets.push({ id: target.id, personId: target.personId })
  }
  return { turfId: turf.id, outreachId: envelope.id, targets }
}

export const knock = async (
  service: TestServiceContext,
  input: {
    slug: string
    outreachId: number | null
    personId: string
    outcome?: DoorKnockOutcome
  },
) =>
  service.prisma.contactInteractionDoorKnock.create({
    data: {
      organizationSlug: input.slug,
      personId: input.personId,
      occurredAt: new Date(),
      outcome: input.outcome ?? DoorKnockOutcome.answered,
      sourceId: randomUUID(),
      actorUserId: service.user.id,
      outreachId: input.outreachId,
    },
  })

// An answered knock and the memo recorded against it, confirmed unless
// told otherwise.
export const seedKnockMemo = async (
  service: TestServiceContext,
  input: {
    slug: string
    outreachId: number
    personId: string
    confirmed?: boolean
    stance?: ConstituentFeedbackStance | null
    desiredOutcome?: string | null
    transcript?: string
  },
) => {
  const row = await knock(service, input)
  const memo = await service.prisma.constituentFeedback.create({
    data: {
      organizationSlug: input.slug,
      personId: input.personId,
      occurredAt: new Date(),
      actorUserId: service.user.id,
      channel: ConstituentFeedbackChannel.door_knock,
      doorKnockInteractionId: row.id,
      transcript: input.transcript ?? 'The storm drain on her corner floods.',
      captureMethod: ConstituentFeedbackCaptureMethod.dictation,
      issueLabel: 'Street flooding',
      stance:
        input.stance === undefined
          ? ConstituentFeedbackStance.opposes
          : input.stance,
      desiredOutcome:
        input.desiredOutcome === undefined ? null : input.desiredOutcome,
      extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
      confirmedAt: input.confirmed === false ? null : new Date(),
      clientKey: row.sourceId!,
      outreachId: input.outreachId,
    },
  })
  return { memo, knockClientKey: row.sourceId! }
}

// A phone list with its envelope and one entry per person.
export const seedPhoneEffort = async (
  service: TestServiceContext,
  slug: string,
  options: { question?: string | null; people?: number } = {},
) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: slug, name: `audience ${suffix()}` },
  })
  const list = await service.prisma.phoneBankingList.create({
    data: {
      organizationSlug: slug,
      voterFileFilterId: filter.id,
      name: 'Calls',
      script: 'Hello.',
      sheetCount: 1,
      purpose: PhoneBankingPurpose.community_input,
      communityInputQuestion: options.question ?? null,
    },
  })
  const envelope = await service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType: OutreachType.nativePhoneBanking,
      status: OutreachStatus.in_progress,
      phoneBankingListId: list.id,
    },
  })
  const entries: Array<{ id: number; personId: string }> = []
  for (let i = 0; i < (options.people ?? 6); i++) {
    const entry = await service.prisma.phoneBankingListEntry.create({
      data: {
        phoneBankingListId: list.id,
        seq: i,
        sheetIndex: 0,
        phone: `30755501${String(i).padStart(2, '0')}`,
      },
    })
    const personId = randomUUID()
    await service.prisma.phoneBankingListEntryPerson.create({
      data: {
        phoneBankingListEntryId: entry.id,
        personId,
        name: `Resident ${i}`,
      },
    })
    entries.push({ id: entry.id, personId })
  }
  return { listId: list.id, outreachId: envelope.id, entries }
}

export const call = async (
  service: TestServiceContext,
  input: {
    slug: string
    listId: number
    personId: string
    outcome?: PhoneBankCallOutcome
  },
) =>
  service.prisma.contactInteractionPhoneBanking.create({
    data: {
      organizationSlug: input.slug,
      phoneBankingListId: input.listId,
      personId: input.personId,
      occurredAt: new Date(),
      outcome: input.outcome ?? PhoneBankCallOutcome.answered,
      actorUserId: service.user.id,
    },
  })

export const seedCallMemo = async (
  service: TestServiceContext,
  input: {
    slug: string
    outreachId: number
    phoneBankingInteractionId: string
    personId: string
  },
) =>
  service.prisma.constituentFeedback.create({
    data: {
      organizationSlug: input.slug,
      personId: input.personId,
      occurredAt: new Date(),
      actorUserId: service.user.id,
      channel: ConstituentFeedbackChannel.phone_bank,
      phoneBankingInteractionId: input.phoneBankingInteractionId,
      transcript: 'He wants the compost pilot on his street.',
      captureMethod: ConstituentFeedbackCaptureMethod.dictation,
      issueLabel: 'Composting pilot',
      stance: ConstituentFeedbackStance.supports,
      extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
      confirmedAt: new Date(),
      clientKey: randomUUID(),
      outreachId: input.outreachId,
    },
  })

// The completion event a synthesis engine hands the ingest, with each
// issue's members listed explicitly.
export const completionEvent = (
  runId: string,
  issues: Array<{ theme: string; memberIds: string[] }>,
) => ({
  type: 'feedbackSynthesisComplete' as const,
  data: {
    sourceType: 'constituent_feedback' as const,
    sourceId: runId,
    totalResponses: issues.reduce((n, i) => n + i.memberIds.length, 0),
    responsesLocation: null,
    issues: issues.map((issue, index) => ({
      rank: index + 1,
      theme: issue.theme,
      summary: `${issue.theme} summary`,
      analysis: `${issue.theme} analysis`,
      responseCount: issue.memberIds.length,
      quotes: issue.memberIds
        .slice(0, 1)
        .map((id) => ({ quote: 'What they said.', respondent_id: id })),
      memberIds: issue.memberIds,
    })),
  },
})

export const ownerHeaders = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
  validateStatus: () => true,
})
