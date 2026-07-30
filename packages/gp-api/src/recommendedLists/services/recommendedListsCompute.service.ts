import { Inject, Injectable } from '@nestjs/common'
import { parseISO } from 'date-fns'
import {
  RaceOpponentSummarySchema,
  RecommendedLists,
  RecommendedListsSchema,
  RecommendedListEnvelope,
  RecommendedListIssueCard,
  RecommendedListPartisan,
  RecommendedListTurf,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma } from '@/generated/prisma'
import { RecommendedListsRecomputeMessage } from '@/queue/queue.types'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { ElectionsService } from '@/elections/services/elections.service'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { WIN_AGENT_VOTER_DIMENSIONS } from '@/chats/general/campaign-manager/services/constituentDimensions.winAgentVoters'
import { getUserFullName } from '@/users/util/users.util'
import {
  CELL_SIZE_FLOOR,
  DOORS_PER_HOUR,
  DOOR_RATIO_FALLBACK,
  SubGeoColumn,
  cardSubtitle,
  electionCode,
  exponentA,
  officeR,
  partisanUnionPredicate,
  pickSubGeo,
  subGeoLabel,
  targetParties,
  votescoreThreshold,
} from './recommendedListsRules.util'
import {
  anchorTurfs,
  districtFilter,
  gotvDropoff,
  issueUniverse,
  partisanAggregate,
  partisanTurfs,
  subGeoStats,
  votescoreHistogram,
} from './recommendedListsQueries'
import { RECOMMENDED_LISTS_REGISTRY } from './recommendedListsRegistry'
import { RECOMMENDED_LISTS_DATABRICKS } from '../recommendedLists.constants'

const SNAPSHOT_STATUS = { pending: 'pending', ready: 'ready', failed: 'failed' }
const MAX_ISSUE_CARDS = 5
const MAX_ERROR_CHARS = 1000

// The three win_agent_voters sub-geography columns the anchor/turf grouping
// picks from. pickSubGeo drops whichever equals the office's own district type.
const SUB_GEO_COLUMNS: readonly SubGeoColumn[] = ['County', 'City', 'Precinct']

const toNum = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim().length > 0) return Number(value)
  return 0
}
const toInt = (value: unknown): number => Math.round(toNum(value))
const round2 = (value: number): number => Math.round(value * 100) / 100

@Injectable()
export class RecommendedListsComputeService extends createPrismaBase(
  MODELS.RecommendedListsSnapshot,
) {
  constructor(
    private readonly districtResolver: DistrictResolverService,
    private readonly elections: ElectionsService,
    @Inject(RECOMMENDED_LISTS_DATABRICKS)
    private readonly databricks: DatabricksProvider | null,
  ) {
    super()
  }

  // Queue handler: idempotent and its own stale-guard, and it NEVER throws — a
  // throw would trigger infinite SQS redelivery. Every outcome resolves to a
  // boolean the consumer acks on. A recompute for a snapshot that is no longer
  // pending, or whose race changed under it, is ack-dropped untouched.
  async handleRecompute(
    message: RecommendedListsRecomputeMessage,
  ): Promise<boolean> {
    const { campaignId, raceId } = message
    try {
      const snapshot = await this.model.findUnique({ where: { campaignId } })
      if (
        !snapshot ||
        snapshot.status !== SNAPSHOT_STATUS.pending ||
        snapshot.raceId !== raceId
      ) {
        this.logger.info(
          { campaignId, raceId, status: snapshot?.status },
          'recommended-lists recompute is stale; ack-dropping',
        )
        return true
      }

      const lists = await this.computeLists(campaignId, raceId)
      const payload = RecommendedListsSchema.parse(lists)
      await this.model.update({
        where: { campaignId },
        data: {
          status: SNAPSHOT_STATUS.ready,
          payload,
          computedAt: new Date(),
          error: null,
        },
      })
      return true
    } catch (error) {
      await this.markFailed(campaignId, error)
      return true
    }
  }

  private async markFailed(campaignId: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error(
      { campaignId, error },
      'recommended-lists recompute failed',
    )
    try {
      await this.model.update({
        where: { campaignId },
        data: {
          status: SNAPSHOT_STATUS.failed,
          error: message.trim().slice(0, MAX_ERROR_CHARS),
        },
      })
    } catch (updateError) {
      this.logger.error(
        { campaignId, updateError },
        'failed to mark recommended-lists snapshot failed',
      )
    }
  }

  private async computeLists(
    campaignId: number,
    raceId: string | null,
  ): Promise<RecommendedLists> {
    const databricks = this.databricks
    if (!databricks) {
      throw new Error('Win Databricks provider is not configured')
    }

    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`)
    }

    const district = await this.districtResolver.resolveByOrgSlug(
      campaign.organizationSlug,
    )
    if (!district) {
      throw new Error(
        `No district resolved for organization ${campaign.organizationSlug}`,
      )
    }

    const context = raceId
      ? await this.elections.fetchCampaignStrategyContext(raceId)
      : null

    const projectedTurnout = context?.projected_turnout ?? null
    const registeredVoters = context?.registered_voters ?? null
    const votesNeeded = context?.win_number_effective ?? null
    const officeLevel = context?.office_level ?? null
    const officeName = context?.official_office_name ?? null
    const electionDate =
      context?.relevant_election_date ?? context?.general_election_date ?? null
    const isPartisanRace = context?.partisan_type === 'partisan'

    const { hasDemOpponent, hasGopOpponent } = this.opponentParties(
      campaign.user ? getUserFullName(campaign.user) : '',
      context?.candidates ?? [],
    )

    const allowedDistrictColumns = new Set(WIN_AGENT_VOTER_DIMENSIONS)
    const allowedHsColumns = new Set(
      WIN_AGENT_VOTER_DIMENSIONS.filter((col) => col.startsWith('hs_')),
    )

    const df = districtFilter(
      district.state,
      district.l2DistrictType,
      district.l2DistrictName,
      allowedDistrictColumns,
    )

    const [histogramRows, subGeoRow] = await Promise.all([
      this.query(votescoreHistogram(df)),
      this.queryOne(subGeoStats(df, SUB_GEO_COLUMNS)),
    ])

    const histogram = histogramRows.map((row) => ({
      score: toInt(row.s),
      n: toInt(row.n),
    }))
    const sstar = votescoreThreshold(histogram, projectedTurnout)
    const sub = pickSubGeo(
      SUB_GEO_COLUMNS.map((col) => ({
        col,
        distinct: toInt(subGeoRow[`${col}_distinct`]),
        coverage: toNum(subGeoRow[`${col}_coverage`]),
      })),
      district.l2DistrictType,
    )

    const anchorBand =
      sstar === null
        ? null
        : histogram
            .filter((row) => row.score >= sstar)
            .reduce((sum, row) => sum + row.n, 0)

    const r = officeR(officeLevel, district.l2DistrictType, isPartisanRace)
    const a = exponentA(r)
    const unionPredicate = partisanUnionPredicate(
      hasDemOpponent,
      hasGopOpponent,
    )

    const [anchorTurfRows, issueEntries, aggregate, partisanTurfRows, dropoff] =
      await Promise.all([
        sstar === null
          ? Promise.resolve([])
          : this.query(anchorTurfs(df, sub, sstar)),
        this.buildIssueCards(campaignId, df, sstar, allowedHsColumns),
        this.queryOne(
          partisanAggregate(df, hasDemOpponent, hasGopOpponent, sstar),
        ),
        this.query(partisanTurfs(df, sub, sstar, unionPredicate)),
        a === null ? Promise.resolve(null) : this.queryOne(gotvDropoff(df, a)),
      ])

    const doorCount =
      anchorBand === null ? null : Math.round(anchorBand * DOOR_RATIO_FALLBACK)

    const partisan: RecommendedListPartisan = {
      shape: hasDemOpponent || hasGopOpponent ? 'P4' : 'NP1',
      isPartisanRace,
      hasDemOpponent,
      hasGopOpponent,
      targetParties: targetParties(
        isPartisanRace,
        hasDemOpponent,
        hasGopOpponent,
      ),
      cardSubtitle: cardSubtitle(hasDemOpponent, hasGopOpponent),
      signals: {
        partySwitchers: toInt(aggregate.switch),
        ticketSplitters: toInt(aggregate.ticket),
        crossoverPrimary: toInt(aggregate.priblt),
        doubleDislike: toInt(aggregate.dislike),
        modeledIndependents: toInt(aggregate.modeledI),
        registrationAddOn: aggregate.reg == null ? null : toInt(aggregate.reg),
      },
      districtTotal: toInt(aggregate.tot),
      districtWideUnionCount: toInt(aggregate.uni),
      plausibleElectorateCount: toInt(aggregate.list1),
      listCount: toInt(aggregate.listn),
      turfs: this.toTurfs(partisanTurfRows),
    }

    const registry = RECOMMENDED_LISTS_REGISTRY
    const lists: RecommendedListEnvelope[] = []
    if (registry.voterSupportId.isActive) {
      lists.push({
        variant: 'voterSupportId',
        goal: registry.voterSupportId.goal,
        name: registry.voterSupportId.name,
        priority: registry.voterSupportId.priority.default,
        allowedOutreachTypes: [...registry.voterSupportId.allowedOutreachTypes],
        allowedPhases: [...registry.voterSupportId.allowedPhases],
        details: {
          votescoreThreshold: sstar,
          voterCount: anchorBand,
          doorCount,
          estimatedHours:
            doorCount === null ? null : doorCount / DOORS_PER_HOUR,
          turfs: this.toTurfs(anchorTurfRows),
        },
      })
    }
    if (registry.persuasionIssueAligned.isActive) {
      lists.push(
        ...issueEntries.map(
          (entry): RecommendedListEnvelope => ({
            variant: 'persuasionIssueAligned',
            goal: registry.persuasionIssueAligned.goal,
            name: entry.name,
            priority: registry.persuasionIssueAligned.priority.default,
            allowedOutreachTypes: [
              ...registry.persuasionIssueAligned.allowedOutreachTypes,
            ],
            allowedPhases: [...registry.persuasionIssueAligned.allowedPhases],
            details: entry.details,
          }),
        ),
      )
    }
    if (registry.persuasionPartisanAligned.isActive) {
      lists.push({
        variant: 'persuasionPartisanAligned',
        goal: registry.persuasionPartisanAligned.goal,
        name: registry.persuasionPartisanAligned.name,
        priority: registry.persuasionPartisanAligned.priority.default,
        allowedOutreachTypes: [
          ...registry.persuasionPartisanAligned.allowedOutreachTypes,
        ],
        allowedPhases: [...registry.persuasionPartisanAligned.allowedPhases],
        details: partisan,
      })
    }

    // A gotv envelope only exists when turnout drop-off applies to this office;
    // its absence (not a null field) is how the reader learns it doesn't.
    if (a !== null && registry.gotv.isActive) {
      lists.push({
        variant: 'gotv',
        goal: registry.gotv.goal,
        name: registry.gotv.name,
        priority: registry.gotv.priority.default,
        allowedOutreachTypes: [...registry.gotv.allowedOutreachTypes],
        allowedPhases: [...registry.gotv.allowedPhases],
        details: {
          dropoffX: dropoff === null ? 0 : toInt(dropoff.X),
          exponentA: round2(a),
        },
      })
    }

    lists.sort((first, second) => first.priority - second.priority)

    return {
      meta: {
        officeName,
        state: district.state,
        districtType: district.l2DistrictType,
        districtName: district.l2DistrictName,
        districtLabel: `${district.l2DistrictName}, ${district.state}`,
        registeredVoters:
          registeredVoters === null ? null : Math.round(registeredVoters),
        projectedTurnout:
          projectedTurnout === null ? null : Math.round(projectedTurnout),
        votesNeeded: votesNeeded === null ? null : Math.round(votesNeeded),
        electionCode: electionCode(
          electionDate ? parseISO(electionDate) : null,
          district.state,
        ),
        electionDate,
        subGeoLabel: subGeoLabel(sub),
        doorRatio: DOOR_RATIO_FALLBACK,
      },
      lists,
    }
  }

  // Every opponent except the candidate themselves (name match, mirroring
  // OpponentResearchService.identify). A race with a Democratic or Republican
  // opponent flips the corresponding flag, which drives the partisan universe
  // predicates and the P4/NP1 shape. Ambiguous/no roster stays NP1-conservative.
  private opponentParties(
    ownName: string,
    candidates: Array<{ full_name: string; party: string | null }>,
  ): { hasDemOpponent: boolean; hasGopOpponent: boolean } {
    const self = ownName.trim().toLowerCase()
    const opponents = candidates.filter(
      (candidate) => candidate.full_name.trim().toLowerCase() !== self,
    )
    return {
      hasDemOpponent: opponents.some((c) => isDemocratParty(c.party)),
      hasGopOpponent: opponents.some((c) => isRepublicanParty(c.party)),
    }
  }

  // One issue card per standout action that carries a Haystaq column, in
  // artifact order, capped. A card whose active-cell count is below the
  // small-cell floor is dropped (aggregate too small to report), as is one
  // whose column somehow isn't an allowed hs_ dimension.
  private async buildIssueCards(
    campaignId: number,
    df: string,
    sstar: number | null,
    allowedHsColumns: ReadonlySet<string>,
  ): Promise<Array<{ name: string; details: RecommendedListIssueCard }>> {
    const [rows, threatByOpponent] = await Promise.all([
      this.client.raceOpponentStandoutAction.findMany({
        where: { campaignId, hsColumn: { not: null } },
        orderBy: { order: Prisma.SortOrder.asc },
        take: MAX_ISSUE_CARDS,
      }),
      this.threatTiersByOpponent(campaignId),
    ])

    const cards: Array<{ name: string; details: RecommendedListIssueCard }> = []
    for (const row of rows) {
      const hsColumn = row.hsColumn
      if (
        !hsColumn ||
        !hsColumn.startsWith('hs_') ||
        !allowedHsColumns.has(hsColumn)
      ) {
        continue
      }
      const dir = row.positionDir === 'low' ? 'low' : 'high'
      const result = await this.queryOne(
        issueUniverse(df, hsColumn, dir, sstar, allowedHsColumns),
      )
      const activeVoters = toInt(result.active)
      if (activeVoters < CELL_SIZE_FLOOR) continue
      const phrase = row.positionPhrase ?? row.issue
      cards.push({
        name: issueAlignedName(dir, phrase),
        details: {
          phrase,
          opponentName: row.opponentName,
          threatTier: row.opponentName
            ? (threatByOpponent.get(row.opponentName.trim().toLowerCase()) ??
              null)
            : null,
          activeVoters,
          supporters: toInt(result.supporters),
          opponents: toInt(result.opponents),
          persuadable: toInt(result.persuadable),
          supportersPlausible: toInt(result.supportersPlausible),
        },
      })
    }
    return cards
  }

  // Threat tier per opponent, keyed by normalized name, read from the persisted
  // race-opponent summaries. A row whose sections don't re-parse is skipped.
  private async threatTiersByOpponent(
    campaignId: number,
  ): Promise<Map<string, string>> {
    const rows = await this.client.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    const byName = new Map<string, string>()
    for (const row of rows) {
      const parsed = RaceOpponentSummarySchema.safeParse(row.sections)
      if (parsed.success && parsed.data.threatTier) {
        byName.set(
          parsed.data.opponentName.trim().toLowerCase(),
          parsed.data.threatTier,
        )
      }
    }
    return byName
  }

  private toTurfs(rows: Array<Record<string, unknown>>): RecommendedListTurf[] {
    return rows.map((row) => ({
      area: String(row.area ?? ''),
      voterCount: toInt(row.n),
    }))
  }

  private async query(sql: string): Promise<Array<Record<string, unknown>>> {
    if (!this.databricks) {
      throw new Error('Win Databricks provider is not configured')
    }
    const result = await this.databricks.query(sql)
    return result.rows
  }

  private async queryOne(sql: string): Promise<Record<string, unknown>> {
    const rows = await this.query(sql)
    return rows[0] ?? {}
  }
}

// Direction-aware issue-list title, per the recommended-lists copy rule: a
// "high" standout means the district leans toward the phrase, "low" leans away.
const issueAlignedName = (dir: 'high' | 'low', phrase: string): string =>
  dir === 'low'
    ? `Voters who lean away from ${phrase}`
    : `Voters who lean toward ${phrase}`

const isDemocratParty = (party: string | null): boolean =>
  party !== null && /democrat/i.test(party)

const isRepublicanParty = (party: string | null): boolean =>
  party !== null && /republic/i.test(party)
