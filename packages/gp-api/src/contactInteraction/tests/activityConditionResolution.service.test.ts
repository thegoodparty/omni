import { useTestService } from '@/test-service'
import {
  DoorKnockOutcome,
  OutreachType,
  SupportAnswer,
} from '@/generated/prisma'
import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActivityConditionResolutionService } from '../services/activityConditionResolution.service'
import { ContactInteractionDoorKnockService } from '../services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '../services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '../services/contactInteractionText.service'

const service = useTestService()

describe('ActivityConditionResolutionService', () => {
  let resolution: ActivityConditionResolutionService
  let doorKnocks: ContactInteractionDoorKnockService
  let texts: ContactInteractionTextService
  let robocalls: ContactInteractionRobocallService

  const seedOrganization = async (slug: string) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return slug
  }

  // Campaign.organizationSlug is unique, so one campaign per org; outreaches
  // hang off it per channel.
  const seedOutreach = async (
    organizationSlug: string,
    outreachType: OutreachType,
  ) => {
    const campaign = await service.prisma.campaign.upsert({
      where: { organizationSlug },
      create: {
        userId: service.user.id,
        slug: `campaign-${organizationSlug}`,
        organizationSlug,
      },
      update: {},
    })
    const outreach = await service.prisma.outreach.create({
      data: { campaignId: campaign.id, outreachType, organizationSlug },
    })
    return outreach.id
  }

  beforeEach(() => {
    resolution = service.app.get(ActivityConditionResolutionService)
    doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    texts = service.app.get(ContactInteractionTextService)
    robocalls = service.app.get(ContactInteractionRobocallService)
  })

  describe('conditions with no supportStatus', () => {
    it('resolves the text "responded" action', async () => {
      const org = await seedOrganization('org-text-responded')
      const outreachId = await seedOutreach(org, OutreachType.text)
      await texts.create({
        organizationSlug: org,
        personId: 'p-responded',
        occurredAt: new Date(),
        outreachId,
        respondedAt: new Date(),
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-not-responded',
        occurredAt: new Date(),
        outreachId,
      })
      // A different outreach's matching row must not leak in when the
      // condition is scoped to a specific outreachId.
      const otherOutreachId = await seedOutreach(org, OutreachType.text)
      await texts.create({
        organizationSlug: org,
        personId: 'p-other-outreach',
        occurredAt: new Date(),
        outreachId: otherOutreachId,
        respondedAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'text', outreachId, actions: ['responded'] },
        ],
      })

      expect(result).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-responded'] },
      })
    })

    it('resolves the text "no_response" action', async () => {
      const org = await seedOrganization('org-text-no-response')
      await texts.create({
        organizationSlug: org,
        personId: 'p-responded',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-no-response',
        occurredAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['no_response'] },
        ],
      })

      expect(result).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-no-response'] },
      })
    })

    it('resolves the text "opted_out" action', async () => {
      const org = await seedOrganization('org-text-opted-out')
      await texts.create({
        organizationSlug: org,
        personId: 'p-opted-out',
        occurredAt: new Date(),
        optedOutAt: new Date(),
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-active',
        occurredAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['opted_out'] },
        ],
      })

      expect(result).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-opted-out'] },
      })
    })

    it('resolves a p2p condition against the same contact_interaction_text table', async () => {
      const org = await seedOrganization('org-p2p')
      const outreachId = await seedOutreach(org, OutreachType.p2p)
      await texts.create({
        organizationSlug: org,
        personId: 'p-p2p-responded',
        occurredAt: new Date(),
        outreachId,
        respondedAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'p2p', outreachId, actions: ['responded'] },
        ],
      })

      expect(result).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-p2p-responded'] },
      })
    })

    it('with no outreachId pinned, "text" and "p2p" resolve only their own channel — manual (no-outreach) rows count toward both', async () => {
      const org = await seedOrganization('org-text-p2p-discrimination')
      const textOutreachId = await seedOutreach(org, OutreachType.text)
      const p2pOutreachId = await seedOutreach(org, OutreachType.p2p)

      await texts.create({
        organizationSlug: org,
        personId: 'p-text-outreach',
        occurredAt: new Date(),
        outreachId: textOutreachId,
        respondedAt: new Date(),
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-p2p-outreach',
        occurredAt: new Date(),
        outreachId: p2pOutreachId,
        respondedAt: new Date(),
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-manual-log',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })

      const textResult = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['responded'] },
        ],
      })
      expect(textResult.kind).toBe('filter')
      if (textResult.kind === 'filter' && 'in' in textResult.idFilter) {
        expect(textResult.idFilter.in.sort()).toEqual([
          'p-manual-log',
          'p-text-outreach',
        ])
      } else {
        throw new Error('expected an in filter')
      }

      const p2pResult = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'p2p', outreachId: null, actions: ['responded'] },
        ],
      })
      expect(p2pResult.kind).toBe('filter')
      if (p2pResult.kind === 'filter' && 'in' in p2pResult.idFilter) {
        expect(p2pResult.idFilter.in.sort()).toEqual([
          'p-manual-log',
          'p-p2p-outreach',
        ])
      } else {
        throw new Error('expected an in filter')
      }
    })

    it('resolves the robocall "answered" action', async () => {
      const org = await seedOrganization('org-robo-answered')
      await robocalls.create({
        organizationSlug: org,
        personId: 'p-answered',
        occurredAt: new Date(),
        answeredAt: new Date(),
      })
      await robocalls.create({
        organizationSlug: org,
        personId: 'p-no-answer',
        occurredAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'robocall', outreachId: null, actions: ['answered'] },
        ],
      })

      expect(result).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-answered'] },
      })
    })

    it('resolves the robocall "voicemail_left" action', async () => {
      const org = await seedOrganization('org-robo-voicemail')
      await robocalls.create({
        organizationSlug: org,
        personId: 'p-voicemail',
        occurredAt: new Date(),
        voicemailLeftAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'robocall',
            outreachId: null,
            actions: ['voicemail_left'],
          },
        ],
      })

      expect(result).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-voicemail'] },
      })
    })

    it('resolves the robocall "no_answer" action (both timestamps null)', async () => {
      const org = await seedOrganization('org-robo-no-answer')
      await robocalls.create({
        organizationSlug: org,
        personId: 'p-no-answer',
        occurredAt: new Date(),
      })
      await robocalls.create({
        organizationSlug: org,
        personId: 'p-answered',
        occurredAt: new Date(),
        answeredAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'robocall',
            outreachId: null,
            actions: ['no_answer'],
          },
        ],
      })

      expect(result).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-no-answer'] },
      })
    })

    it('resolves door-knock outcome actions (answered, not_home, refused_to_engage)', async () => {
      const org = await seedOrganization('org-dk-outcomes')
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-answered',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        manual: true,
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-not-home',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.not_home,
        manual: true,
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-refused',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.refused_to_engage,
        manual: true,
      })

      const answered = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['answered'],
          },
        ],
      })
      expect(answered).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-answered'] },
      })

      const notHome = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['not_home'],
          },
        ],
      })
      expect(notHome).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-not-home'] },
      })

      const refused = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['refused_to_engage'],
          },
        ],
      })
      expect(refused).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-refused'] },
      })
    })

    it('resolves door-knock support-answer actions (support_yes, support_unsure, support_no)', async () => {
      const org = await seedOrganization('org-dk-support-answers')
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-yes',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        manual: true,
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-unsure',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.unsure,
        manual: true,
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-no',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.non_supporter,
        manual: true,
      })

      const yes = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['support_yes'],
          },
        ],
      })
      expect(yes).toEqual({ kind: 'filter', idFilter: { in: ['p-yes'] } })

      const unsure = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['support_unsure'],
          },
        ],
      })
      expect(unsure).toEqual({ kind: 'filter', idFilter: { in: ['p-unsure'] } })

      const no = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['support_no'],
          },
        ],
      })
      expect(no).toEqual({ kind: 'filter', idFilter: { in: ['p-no'] } })
    })

    it('empty actions = membership only (everyone with any row for that channel/outreach)', async () => {
      const org = await seedOrganization('org-membership-only')
      const outreachId = await seedOutreach(org, OutreachType.text)
      await texts.create({
        organizationSlug: org,
        personId: 'p-1',
        occurredAt: new Date(),
        outreachId,
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-2',
        occurredAt: new Date(),
        outreachId,
        optedOutAt: new Date(),
      })
      // A different outreach — must not be included when scoped to outreachId.
      const otherOutreachId = await seedOutreach(org, OutreachType.text)
      await texts.create({
        organizationSlug: org,
        personId: 'p-other',
        occurredAt: new Date(),
        outreachId: otherOutreachId,
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [{ outreachType: 'text', outreachId, actions: [] }],
      })

      expect(result.kind).toBe('filter')
      if (result.kind === 'filter' && 'in' in result.idFilter) {
        expect(result.idFilter.in.sort()).toEqual(['p-1', 'p-2'])
      } else {
        throw new Error('expected an in filter')
      }
    })

    it('AND-intersects two conditions — only people in both sets return', async () => {
      const org = await seedOrganization('org-and-intersect')
      const textOutreachId = await seedOutreach(org, OutreachType.text)
      const robocallOutreachId = await seedOutreach(org, OutreachType.robocall)

      // p-both matches both conditions; p-text-only and p-robo-only match
      // only one each.
      await texts.create({
        organizationSlug: org,
        personId: 'p-both',
        occurredAt: new Date(),
        outreachId: textOutreachId,
        respondedAt: new Date(),
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-text-only',
        occurredAt: new Date(),
        outreachId: textOutreachId,
        respondedAt: new Date(),
      })
      await robocalls.create({
        organizationSlug: org,
        personId: 'p-both',
        occurredAt: new Date(),
        outreachId: robocallOutreachId,
        answeredAt: new Date(),
      })
      await robocalls.create({
        organizationSlug: org,
        personId: 'p-robo-only',
        occurredAt: new Date(),
        outreachId: robocallOutreachId,
        answeredAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: textOutreachId,
            actions: ['responded'],
          },
          {
            outreachType: 'robocall',
            outreachId: robocallOutreachId,
            actions: ['answered'],
          },
        ],
      })

      expect(result).toEqual({ kind: 'filter', idFilter: { in: ['p-both'] } })
    })

    it('scopes strictly by organization — a matching row in another org is not included', async () => {
      const orgA = await seedOrganization('org-a-isolation')
      const orgB = await seedOrganization('org-b-isolation')
      await texts.create({
        organizationSlug: orgA,
        personId: 'p-shared-id',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })
      await texts.create({
        organizationSlug: orgB,
        personId: 'p-shared-id',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })

      const resultA = await resolution.resolveIdFilter(orgA, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['responded'] },
        ],
      })
      expect(resultA).toEqual({
        kind: 'filter',
        idFilter: { in: ['p-shared-id'] },
      })

      const orgC = await seedOrganization('org-c-isolation-empty')
      const resultC = await resolution.resolveIdFilter(orgC, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['responded'] },
        ],
      })
      expect(resultC).toEqual({ kind: 'empty' })
    })

    it('a condition matching nobody resolves to kind "empty"', async () => {
      const org = await seedOrganization('org-empty-condition')
      await texts.create({
        organizationSlug: org,
        personId: 'p-1',
        occurredAt: new Date(),
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['responded'] },
        ],
      })

      expect(result).toEqual({ kind: 'empty' })
    })
  })

  describe('supportStatus only', () => {
    it('resolves a non-unknown selection as an "in" set', async () => {
      const org = await seedOrganization('org-support-in')
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-sup',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        manual: true,
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-non',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.non_supporter,
        manual: true,
      })

      const result = await resolution.resolveIdFilter(org, {
        supportStatus: ['supporter'],
      })

      expect(result).toEqual({ kind: 'filter', idFilter: { in: ['p-sup'] } })
    })

    it('resolves a selection including "unknown" as the notIn complement', async () => {
      const org = await seedOrganization('org-support-unknown')
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-sup',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        manual: true,
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-non',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.non_supporter,
        manual: true,
      })

      const result = await resolution.resolveIdFilter(org, {
        supportStatus: ['unknown'],
      })

      expect(result.kind).toBe('filter')
      if (result.kind === 'filter' && 'notIn' in result.idFilter) {
        expect(result.idFilter.notIn.sort()).toEqual(['p-non', 'p-sup'])
      } else {
        throw new Error('expected a notIn filter')
      }
    })

    it('selecting every rollup (including unknown) collapses to "none" — nothing to exclude', async () => {
      const org = await seedOrganization('org-support-all')
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-sup',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        manual: true,
      })

      const result = await resolution.resolveIdFilter(org, {
        supportStatus: ['supporter', 'non_supporter', 'unknown'],
      })

      expect(result).toEqual({ kind: 'none' })
    })

    it('an "unknown" selection with nobody contacted yet collapses to "none"', async () => {
      const org = await seedOrganization('org-support-unknown-fresh')

      const result = await resolution.resolveIdFilter(org, {
        supportStatus: ['unknown'],
      })

      expect(result).toEqual({ kind: 'none' })
    })
  })

  describe('conditions + supportStatus composed together', () => {
    it('intersects conditions with a non-unknown support selection', async () => {
      const org = await seedOrganization('org-mixed-in')
      await texts.create({
        organizationSlug: org,
        personId: 'p-match',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })
      await texts.create({
        organizationSlug: org,
        personId: 'p-condition-only',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-match',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        manual: true,
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['responded'] },
        ],
        supportStatus: ['supporter'],
      })

      expect(result).toEqual({ kind: 'filter', idFilter: { in: ['p-match'] } })
    })

    it('collapses a mixed conditions + unknown-inclusive support selection to a single "in"', async () => {
      const org = await seedOrganization('org-mixed-unknown')
      // p-keep: matches the condition and has no known support answer (unknown).
      await texts.create({
        organizationSlug: org,
        personId: 'p-keep',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })
      // p-drop: matches the condition but is a known non-supporter — excluded.
      await texts.create({
        organizationSlug: org,
        personId: 'p-drop',
        occurredAt: new Date(),
        respondedAt: new Date(),
      })
      await doorKnocks.create({
        organizationSlug: org,
        personId: 'p-drop',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.non_supporter,
        manual: true,
      })

      const result = await resolution.resolveIdFilter(org, {
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['responded'] },
        ],
        supportStatus: ['unknown'],
      })

      // Single `in` operator, never a `notIn` — people-api accepts exactly one.
      expect(result).toEqual({ kind: 'filter', idFilter: { in: ['p-keep'] } })
    })
  })

  describe('no conditions and no supportStatus', () => {
    it('resolves to "none" without querying anything', async () => {
      const org = await seedOrganization('org-noop')
      const result = await resolution.resolveIdFilter(org, {})
      expect(result).toEqual({ kind: 'none' })
    })
  })

  describe('the 100k cap', () => {
    it('throws BadRequestException when the resolved "in" set exceeds the cap', async () => {
      const org = await seedOrganization('org-over-cap')
      // A single INSERT ... SELECT is far cheaper than materializing 100k+
      // rows client-side; only person_id needs to vary per row.
      await service.prisma.$executeRaw`
        INSERT INTO contact_interaction_text (id, organization_slug, person_id, occurred_at)
        SELECT gen_random_uuid()::text, ${org}, 'cap-person-' || gen_series, now()
        FROM generate_series(1, 100001) AS gen_series
      `

      await expect(
        resolution.resolveIdFilter(org, {
          activityConditions: [
            { outreachType: 'text', outreachId: null, actions: [] },
          ],
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
