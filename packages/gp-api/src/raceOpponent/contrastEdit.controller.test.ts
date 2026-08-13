import { useTestService } from '@/test-service'
import {
  RaceOpponentContrastStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { describe, expect, it } from 'vitest'

const service = useTestService()

const SLUG = 'campaign-edit'
const OTHER_SLUG = 'campaign-edit-other'
const ORG_SLUG_HEADER = 'X-Organization-Slug'

const CONTRAST_SENTENCE =
  'On Housing, my opponent voted against the bill — I support more housing.'
const NEW_SENTENCE =
  'On Housing, my opponent blocked the bill — I will build more homes.'

const seedCampaign = async (slug: string, isPro = true) => {
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro,
    },
  })
}

const seedCompletedSelfPass = (campaignId: number) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.self,
      status: RaceOpponentResearchStatus.completed,
      runId: 'self-done',
    },
  })

const seedContrast = (campaignId: number, status: RaceOpponentContrastStatus) =>
  service.prisma.raceOpponentContrast.create({
    data: {
      campaignId,
      opponentFact: 'voted against the bill',
      sourceUrl: 'https://ballotpedia.org/finding',
      candidateFact: 'support more housing',
      contrastSentence: CONTRAST_SENTENCE,
      issueTag: 'Housing',
      routing: 'story',
      status,
    },
  })

const editPath = (id: number) =>
  `/v1/campaigns/mine/race-opponent/contrasts/${id}`

const edit = (id: number, body: Record<string, unknown>, slug = SLUG) =>
  service.client.patch(editPath(id), body, {
    headers: { [ORG_SLUG_HEADER]: slug },
  })

describe('PATCH /v1/campaigns/mine/race-opponent/contrasts/:id', () => {
  it('persists the new text and increments editCount on a cleared contrast', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await edit(contrast.id, {
      contrastSentence: NEW_SENTENCE,
      candidateFact: 'will build more homes',
    })

    expect(result.status).toBe(200)
    expect(result.data.contrast.contrastSentence).toBe(NEW_SENTENCE)
    expect(result.data.contrast.candidateFact).toBe('will build more homes')
    expect(result.data.contrast.editCount).toBe(1)

    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.contrastSentence).toBe(NEW_SENTENCE)
    expect(row.candidateFact).toBe('will build more homes')
    expect(row.editCount).toBe(1)
    // Editing does not change the status — nothing is routed or sent.
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
  })

  it('increments editCount on each successive edit', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.approved,
    )

    await edit(contrast.id, { contrastSentence: NEW_SENTENCE })
    const second = await edit(contrast.id, {
      contrastSentence: `${NEW_SENTENCE} (v2)`,
    })

    expect(second.status).toBe(200)
    expect(second.data.contrast.editCount).toBe(2)
    expect(second.data.contrast.contrastSentence).toBe(`${NEW_SENTENCE} (v2)`)
  })

  it('edits an approved contrast (approved is editable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.approved,
    )

    const result = await edit(contrast.id, { contrastSentence: NEW_SENTENCE })

    expect(result.status).toBe(200)
    expect(result.data.contrast.contrastSentence).toBe(NEW_SENTENCE)
  })

  it('409s editing a used contrast (frozen once routed)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.used,
    )

    const result = await edit(contrast.id, { contrastSentence: NEW_SENTENCE })

    expect(result.status).toBe(409)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.contrastSentence).toBe(CONTRAST_SENTENCE)
    expect(row.editCount).toBe(0)
  })

  it('409s editing a pending_review contrast (not editable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.pending_review,
    )

    const result = await edit(contrast.id, { contrastSentence: NEW_SENTENCE })

    expect(result.status).toBe(409)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.contrastSentence).toBe(CONTRAST_SENTENCE)
    expect(row.editCount).toBe(0)
  })

  it('404s editing a contrast owned by another campaign', async () => {
    const mine = await seedCampaign(SLUG)
    await seedCompletedSelfPass(mine.id)
    const other = await seedCampaign(OTHER_SLUG)
    const theirContrast = await seedContrast(
      other.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await edit(
      theirContrast.id,
      { contrastSentence: NEW_SENTENCE },
      SLUG,
    )

    expect(result.status).toBe(404)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: theirContrast.id },
    })
    expect(row.contrastSentence).toBe(CONTRAST_SENTENCE)
    expect(row.editCount).toBe(0)
  })

  it('403s edit when no self-research pass is completed (the gate)', async () => {
    const campaign = await seedCampaign(SLUG)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await edit(contrast.id, { contrastSentence: NEW_SENTENCE })

    expect(result.status).toBe(403)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.contrastSentence).toBe(CONTRAST_SENTENCE)
    expect(row.editCount).toBe(0)
  })

  it('403s edit for a non-Pro campaign', async () => {
    const campaign = await seedCampaign(SLUG, false)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await edit(contrast.id, { contrastSentence: NEW_SENTENCE })

    expect(result.status).toBe(403)
  })

  it('400s an empty contrastSentence (min length enforced)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await edit(contrast.id, { contrastSentence: '' })

    expect(result.status).toBe(400)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.contrastSentence).toBe(CONTRAST_SENTENCE)
    expect(row.editCount).toBe(0)
  })

  it('400s an empty PATCH and does not bump editCount or change text', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await edit(contrast.id, {})

    expect(result.status).toBe(400)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.contrastSentence).toBe(CONTRAST_SENTENCE)
    expect(row.candidateFact).toBe('support more housing')
    expect(row.editCount).toBe(0)
  })

  it('ignores a sourced field (opponentFact) in the edit body', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    // opponentFact is sourced and immutable. Sending it alongside a real edit
    // must not change opponentFact (the schema strips it; the service never
    // writes it).
    const result = await edit(contrast.id, {
      contrastSentence: NEW_SENTENCE,
      opponentFact: 'A FABRICATED opponent claim',
      issueTag: 'Economy',
      routing: 'mail',
    })

    expect(result.status).toBe(200)
    expect(result.data.contrast.opponentFact).toBe('voted against the bill')
    expect(result.data.contrast.contrastSentence).toBe(NEW_SENTENCE)

    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.opponentFact).toBe('voted against the bill')
    expect(row.issueTag).toBe('Housing')
    expect(row.routing).toBe('story')
    expect(row.sourceUrl).toBe('https://ballotpedia.org/finding')
  })
})
