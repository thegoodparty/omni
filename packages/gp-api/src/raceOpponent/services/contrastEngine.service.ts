import { Injectable } from '@nestjs/common'
import {
  GenerateContrastsResponse,
  ListContrastsResponse,
  RaceOpponentContrast as RaceOpponentContrastDTO,
  RaceOpponentContrastRouting,
  RaceOpponentContrastRoutingSchema,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  Prisma,
  RaceOpponentContrast as RaceOpponentContrastRow,
  RaceOpponentContrastStatus,
  RaceOpponentFinding,
  RaceOpponentFindingKind,
} from '@/generated/prisma'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { ContrastToneService } from './contrastTone.service'

const DEFAULT_ROUTING: RaceOpponentContrastRouting = 'story'

// Statuses visible to the candidate: only contrasts that have passed the
// fair-line gate. `draft` is excluded on purpose — it is the column default, so
// a manually-authored contrast (findingId null, not deduped) lands as draft and
// would otherwise be candidate-visible without ever being reviewed.
// pending_review and blocked stay hidden until a reviewer verdict clears them.
const CANDIDATE_VISIBLE_STATUSES: RaceOpponentContrastStatus[] = [
  RaceOpponentContrastStatus.cleared,
  RaceOpponentContrastStatus.approved,
  RaceOpponentContrastStatus.used,
]

type CandidatePosition = {
  issue: string
  fact: string
}

// Builds RaceOpponentContrast rows by pairing each opponent finding with the
// candidate's own matching position, de-escalating the contrast sentence, and
// routing near-the-line drafts to the human fair-line gate (status
// pending_review). A finding with no candidate-side position yields no contrast
// (never a half-contrast); an out-of-allowlist category yields none either.
@Injectable()
export class ContrastEngineService extends createPrismaBase(
  MODELS.RaceOpponentContrast,
) {
  constructor(private readonly tone: ContrastToneService) {
    super()
  }

  // Idempotent: a contrast already exists for a (campaign, finding) pair is
  // skipped (pre-check), and the @@unique([campaignId, findingId]) index is the
  // race-proof backstop — a concurrent generate that slips past the pre-check
  // hits P2002 and is treated as already-done, never a duplicate. So a second
  // generate() never inflates the response, routedToReviewCount, or list().
  async generate(campaignId: number): Promise<GenerateContrastsResponse> {
    const findings = await this.loadOpponentFindings(campaignId)
    const positions = await this.loadCandidatePositions(campaignId)
    const alreadyContrasted = await this.existingFindingIds(campaignId)

    const cleared: RaceOpponentContrastDTO[] = []
    let routedToReviewCount = 0

    for (const finding of findings) {
      if (alreadyContrasted.has(finding.id)) continue
      if (!this.tone.isCategoryAllowed(finding.category)) continue

      const match = this.matchPosition(finding, positions)
      if (!match) continue

      const { sentence, nearTheLine } = this.tone.check(
        this.draftSentence(finding, match),
      )

      const row = await this.createContrast(
        campaignId,
        finding,
        match,
        sentence,
        nearTheLine,
      )
      if (!row) continue

      if (nearTheLine) {
        routedToReviewCount += 1
      } else {
        cleared.push(toDTO(row))
      }
    }

    return { contrasts: cleared, routedToReviewCount }
  }

  // Returns null when a concurrent generate already created the contrast for
  // this finding (P2002 on the unique index) — the row exists, which is all the
  // idempotent caller needs. Any other Prisma error is rethrown.
  private async createContrast(
    campaignId: number,
    finding: RaceOpponentFinding,
    match: CandidatePosition,
    sentence: string,
    nearTheLine: boolean,
  ): Promise<RaceOpponentContrastRow | null> {
    try {
      return await this.model.create({
        data: {
          campaignId,
          findingId: finding.id,
          opponentFact: finding.claim,
          sourceUrl: finding.sourceUrl,
          candidateFact: match.fact,
          contrastSentence: sentence,
          issueTag: match.issue,
          routing: DEFAULT_ROUTING,
          status: nearTheLine
            ? RaceOpponentContrastStatus.pending_review
            : RaceOpponentContrastStatus.cleared,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) return null
      throw error
    }
  }

  private async existingFindingIds(campaignId: number): Promise<Set<number>> {
    const rows = await this.model.findMany({
      where: { campaignId, findingId: { not: null } },
      select: { findingId: true },
    })
    return new Set(
      rows.flatMap((r) => (r.findingId === null ? [] : [r.findingId])),
    )
  }

  async list(campaignId: number): Promise<ListContrastsResponse> {
    const rows = await this.model.findMany({
      where: { campaignId, status: { in: CANDIDATE_VISIBLE_STATUSES } },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    })
    return { contrasts: rows.map(toDTO) }
  }

  private loadOpponentFindings(
    campaignId: number,
  ): Promise<RaceOpponentFinding[]> {
    return this.client.raceOpponentFinding.findMany({
      where: {
        research: { campaignId, kind: RaceOpponentFindingKind.opponent },
      },
      orderBy: { id: Prisma.SortOrder.asc },
    })
  }

  // The candidate-fact half: the campaign's positions, each carrying the issue
  // name (TopIssue, else Position) and the candidate's free-text stance. A
  // position with no stance can't anchor a contrast (there's no candidate fact
  // to state), so it is excluded — those findings then correctly yield nothing.
  private async loadCandidatePositions(
    campaignId: number,
  ): Promise<CandidatePosition[]> {
    const rows = await this.client.campaignPosition.findMany({
      where: { campaignId, description: { not: null } },
      include: { position: true, topIssue: true },
    })
    return rows.flatMap((row) => {
      const issue = row.topIssue?.name ?? row.position.name
      const fact = row.description?.trim() ?? ''
      return fact.length > 0 ? [{ issue, fact }] : []
    })
  }

  // Deterministic match: a finding pairs with the candidate position whose
  // issue name appears (case-insensitive) in the finding's claim or category.
  // An unmatched finding must yield no contrast, so a strict substring match is
  // the right precision here — no fuzzy scoring.
  private matchPosition(
    finding: RaceOpponentFinding,
    positions: CandidatePosition[],
  ): CandidatePosition | null {
    const haystack = `${finding.claim} ${finding.category}`.toLowerCase()
    return (
      positions.find((p) => haystack.includes(p.issue.toLowerCase())) ?? null
    )
  }

  private draftSentence(
    finding: RaceOpponentFinding,
    position: CandidatePosition,
  ): string {
    return `On ${position.issue}, my opponent ${finding.claim} — I ${position.fact}.`
  }
}

const toDTO = (row: RaceOpponentContrastRow): RaceOpponentContrastDTO => ({
  id: row.id,
  opponentFact: row.opponentFact,
  sourceUrl: row.sourceUrl,
  candidateFact: row.candidateFact,
  contrastSentence: row.contrastSentence,
  issueTag: row.issueTag,
  routing: RaceOpponentContrastRoutingSchema.parse(row.routing),
  status: row.status,
  editCount: row.editCount,
  findingId: row.findingId,
  routedStoryId: row.routedStoryId,
  routedOutreachId: row.routedOutreachId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export { toDTO as contrastToDTO }
