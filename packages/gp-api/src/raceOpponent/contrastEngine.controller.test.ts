import { useTestService } from '@/test-service'
import {
  ArtifactReviewResourceType,
  ArtifactReviewVerdict,
  RaceOpponentContrastStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
  UserRole,
} from '@/generated/prisma'
import { describe, expect, it } from 'vitest'

const service = useTestService()

const SLUG = 'campaign-contrast'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const GENERATE_PATH = '/v1/campaigns/mine/race-opponent/contrasts/generate'
const LIST_PATH = '/v1/campaigns/mine/race-opponent/contrasts'

const ISSUE = 'Housing'
const CLEAN_CLAIM = 'voted against the Housing affordability bill in 2023'
const INFLATED_CLAIM = 'has a corrupt, reckless Housing record'
const CANDIDATE_STANCE = 'support more affordable Housing'

const seedCampaign = async (opts: { isPro: boolean }) => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${SLUG}-campaign`,
      organizationSlug: SLUG,
      isPro: opts.isPro,
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

// One opponent-research row whose findings the engine will pair with the
// candidate's positions. Each finding carries a category + claim; the test
// controls allowlist/match by what it seeds.
const seedOpponentFindings = async (
  campaignId: number,
  findings: { category: string; claim: string }[],
) => {
  const research = await service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.opponent,
      opponentName: 'Jane Rival',
      status: RaceOpponentResearchStatus.completed,
      runId: 'opp-done',
    },
  })
  await service.prisma.raceOpponentFinding.createMany({
    data: findings.map((f, i) => ({
      researchId: research.id,
      claim: f.claim,
      sourceUrl: `https://ballotpedia.org/finding-${i}`,
      sourceExtract: 'extract',
      sourceReachableAt: new Date(),
      category: f.category,
    })),
  })
  return research
}

const seedCandidatePosition = async (
  campaignId: number,
  issueName: string,
  description: string,
) => {
  const topIssue = await service.prisma.topIssue.create({
    data: { name: issueName },
  })
  const position = await service.prisma.position.create({
    data: { name: `${issueName} position`, topIssueId: topIssue.id },
  })
  await service.prisma.campaignPosition.create({
    data: {
      campaignId,
      positionId: position.id,
      topIssueId: topIssue.id,
      description,
    },
  })
}

const generate = () =>
  service.client.post(
    GENERATE_PATH,
    {},
    { headers: { [ORG_SLUG_HEADER]: SLUG } },
  )

const list = () =>
  service.client.get(LIST_PATH, { headers: { [ORG_SLUG_HEADER]: SLUG } })

const verdictPath = (id: number) =>
  `/v1/campaigns/mine/race-opponent/contrasts/${id}/review-verdict`

// The verdict route is AdminOrM2MGuard-gated; the default test user is not an
// admin, so a reviewer test must promote it first.
const makeReviewerAdmin = () =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

describe('POST /v1/campaigns/mine/race-opponent/contrasts/generate', () => {
  it('returns a clean contrast directly (cleared, candidate-visible)', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: CLEAN_CLAIM },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    const result = await generate()

    expect(result.status).toBe(201)
    expect(result.data.routedToReviewCount).toBe(0)
    expect(result.data.contrasts).toHaveLength(1)
    const contrast = result.data.contrasts[0]
    expect(contrast.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(contrast.opponentFact).toBe(CLEAN_CLAIM)
    expect(contrast.candidateFact).toBe(CANDIDATE_STANCE)
    expect(contrast.issueTag).toBe(ISSUE)

    const listed = await list()
    expect(listed.data.contrasts).toHaveLength(1)
    expect(listed.data.contrasts[0].id).toBe(contrast.id)
  })

  it('does not spuriously pair a short issue name ("AI") with an unrelated finding', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    // The finding is about campaign finance; "ai" is a substring of
    // "campaign_finance" but not a whole word, so it must not pair.
    await seedOpponentFindings(campaign.id, [
      {
        category: 'campaign_finance',
        claim: 'took maximum donations from a single PAC',
      },
    ])
    await seedCandidatePosition(campaign.id, 'AI', 'support AI safeguards')

    const result = await generate()

    expect(result.status).toBe(201)
    expect(result.data.contrasts).toHaveLength(0)
    const rows = await service.prisma.raceOpponentContrast.findMany({
      where: { campaignId: campaign.id },
    })
    expect(rows).toHaveLength(0)
  })

  it('composes a clean contrastSentence when the claim ends in a period', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: `voted against the ${ISSUE} bill.` },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, `${CANDIDATE_STANCE}.`)

    const result = await generate()

    expect(result.status).toBe(201)
    expect(result.data.contrasts).toHaveLength(1)
    const { contrastSentence } = result.data.contrasts[0]
    // No "claim. — " artifact and no doubled end period.
    expect(contrastSentence).not.toContain('. — ')
    expect(contrastSentence).not.toContain('..')
    expect(contrastSentence).toBe(
      `On ${ISSUE}, my opponent voted against the ${ISSUE} bill — ` +
        `I ${CANDIDATE_STANCE}.`,
    )
  })

  it('is idempotent: a second generate does not duplicate contrasts', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: CLEAN_CLAIM },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    const first = await generate()
    expect(first.data.contrasts).toHaveLength(1)

    // Re-generate: the finding already has a contrast, so nothing new is made.
    const second = await generate()
    expect(second.status).toBe(201)
    expect(second.data.contrasts).toHaveLength(0)
    expect(second.data.routedToReviewCount).toBe(0)

    const rows = await service.prisma.raceOpponentContrast.findMany({
      where: { campaignId: campaign.id },
    })
    expect(rows).toHaveLength(1)
    const listed = await list()
    expect(listed.data.contrasts).toHaveLength(1)
  })

  it('routes a near-the-line contrast to review and hides it from the candidate read path until a passed verdict lands', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: INFLATED_CLAIM },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    const result = await generate()

    // Inflated draft is near-the-line: routed to review, not returned.
    expect(result.status).toBe(201)
    expect(result.data.contrasts).toHaveLength(0)
    expect(result.data.routedToReviewCount).toBe(1)

    // Absent from the candidate read path while pending_review.
    const beforeVerdict = await list()
    expect(beforeVerdict.data.contrasts).toHaveLength(0)

    const pending = await service.prisma.raceOpponentContrast.findFirstOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(pending.status).toBe(RaceOpponentContrastStatus.pending_review)
    // The inflation term was stripped by the deterministic tone pass.
    expect(pending.contrastSentence).not.toContain('corrupt')

    // Apply a real passed verdict through the controller (no setVerdict mock).
    await makeReviewerAdmin()
    const passed = await service.client.put(
      verdictPath(pending.id),
      { verdict: ArtifactReviewVerdict.passed },
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )
    expect(passed.status).toBe(200)
    expect(passed.data.verdict).toBe(ArtifactReviewVerdict.passed)

    // The verdict created a real ArtifactReview record for the contrast.
    const review = await service.prisma.artifactReview.findFirstOrThrow({
      where: {
        resourceType: ArtifactReviewResourceType.race_opponent_contrast,
        resourceId: String(pending.id),
      },
    })
    expect(review.verdict).toBe(ArtifactReviewVerdict.passed)

    // Now candidate-visible.
    const afterVerdict = await list()
    expect(afterVerdict.data.contrasts).toHaveLength(1)
    expect(afterVerdict.data.contrasts[0].status).toBe(
      RaceOpponentContrastStatus.cleared,
    )
  })

  it('a failed verdict blocks the contrast (stays hidden, carries the reason)', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: INFLATED_CLAIM },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    await generate()
    const pending = await service.prisma.raceOpponentContrast.findFirstOrThrow({
      where: { campaignId: campaign.id },
    })

    await makeReviewerAdmin()
    const failed = await service.client.put(
      verdictPath(pending.id),
      {
        verdict: ArtifactReviewVerdict.failed,
        failReason: 'still reads as an attack',
      },
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )
    expect(failed.status).toBe(200)
    expect(failed.data.failReason).toBe('still reads as an attack')

    const blocked = await service.prisma.raceOpponentContrast.findUniqueOrThrow(
      {
        where: { id: pending.id },
      },
    )
    expect(blocked.status).toBe(RaceOpponentContrastStatus.blocked)

    const listed = await list()
    expect(listed.data.contrasts).toHaveLength(0)
  })

  it('409s when applying a verdict to an already-cleared contrast', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: INFLATED_CLAIM },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    await generate()
    const pending = await service.prisma.raceOpponentContrast.findFirstOrThrow({
      where: { campaignId: campaign.id },
    })
    await makeReviewerAdmin()

    const firstVerdict = await service.client.put(
      verdictPath(pending.id),
      { verdict: ArtifactReviewVerdict.passed },
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )
    expect(firstVerdict.status).toBe(200)

    // A second verdict on the now-cleared contrast is a state conflict.
    const secondVerdict = await service.client.put(
      verdictPath(pending.id),
      {
        verdict: ArtifactReviewVerdict.failed,
        failReason: 'changed my mind',
      },
      { headers: { [ORG_SLUG_HEADER]: SLUG } },
    )
    expect(secondVerdict.status).toBe(409)

    // The contrast stayed cleared — the rejected verdict did not re-block it.
    const unchanged =
      await service.prisma.raceOpponentContrast.findUniqueOrThrow({
        where: { id: pending.id },
      })
    expect(unchanged.status).toBe(RaceOpponentContrastStatus.cleared)
  })

  it('rejects an out-of-allowlist category server-side (no contrast)', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      {
        category: 'family',
        claim: `something about ${ISSUE} and their family`,
      },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    const result = await generate()

    expect(result.status).toBe(201)
    expect(result.data.contrasts).toHaveLength(0)
    expect(result.data.routedToReviewCount).toBe(0)
    const rows = await service.prisma.raceOpponentContrast.findMany({
      where: { campaignId: campaign.id },
    })
    expect(rows).toHaveLength(0)
  })

  it('yields no contrast for a finding with no matching candidate position', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: CLEAN_CLAIM },
    ])
    // Candidate has a position on a DIFFERENT issue — no half-contrast.
    await seedCandidatePosition(campaign.id, 'Education', 'fund schools')

    const result = await generate()

    expect(result.status).toBe(201)
    expect(result.data.contrasts).toHaveLength(0)
    const rows = await service.prisma.raceOpponentContrast.findMany({
      where: { campaignId: campaign.id },
    })
    expect(rows).toHaveLength(0)
  })

  it('403s generate when no self-research pass is completed (the gate)', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: CLEAN_CLAIM },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    const result = await generate()

    expect(result.status).toBe(403)
  })

  it('403s generate when the campaign is not Pro', async () => {
    const campaign = await seedCampaign({ isPro: false })
    await seedCompletedSelfPass(campaign.id)
    await seedOpponentFindings(campaign.id, [
      { category: 'voting_record', claim: CLEAN_CLAIM },
    ])
    await seedCandidatePosition(campaign.id, ISSUE, CANDIDATE_STANCE)

    const result = await generate()

    expect(result.status).toBe(403)
  })
})

describe('GET /v1/campaigns/mine/race-opponent/contrasts', () => {
  it('403s list when the campaign is not Pro', async () => {
    await seedCampaign({ isPro: false })

    const result = await list()

    expect(result.status).toBe(403)
  })
})
