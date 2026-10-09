import { Injectable } from '@nestjs/common'
import { addMinutes, isAfter } from 'date-fns'
import { Campaign, Organization } from '@/generated/prisma'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { CampaignExperimentAssignmentService } from '@/features/services/campaignExperimentAssignment.service'
import {
  type AffinityColumn,
  DEFAULT_AFFINITY_COLUMN,
} from '@/peopleDb/affinityColumns.const'
import { stateLegAffinityColumn } from '../utils/independentModelScenario.util'

export const INDEPENDENT_MODEL_FLAG_KEY = 'independent-model-used'

export enum IndependentModelArm {
  Control = 'control',
  Haystaq = 'haystaq',
  StateLeg = 'stateleg',
}

const ARMS: readonly string[] = Object.values(IndependentModelArm)

const isArm = (value: string): value is IndependentModelArm =>
  ARMS.includes(value)

const SCENARIO_CACHE_MINUTES = 10

@Injectable()
export class IndependentAffinityColumnService {
  // The wizard fires a count per filter change; the scenario only moves when
  // the race's field changes in election-api, so it is memoized briefly.
  private readonly scenarioCache = new Map<
    number,
    { column: AffinityColumn; expiresAt: Date }
  >()

  constructor(
    private readonly assignments: CampaignExperimentAssignmentService,
    private readonly campaigns: CampaignsService,
    private readonly elections: ElectionsService,
  ) {}

  // Campaigns outside the experiment (no campaign, or no arm yet) read the
  // column every campaign read before the experiment.
  async resolve(org: Organization): Promise<AffinityColumn> {
    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug: org.slug },
    })
    if (!campaign) return DEFAULT_AFFINITY_COLUMN

    const arm = await this.assignments.getOrAssign({
      campaign,
      flagKey: INDEPENDENT_MODEL_FLAG_KEY,
      arms: ARMS,
    })
    if (!arm || !isArm(arm)) return DEFAULT_AFFINITY_COLUMN

    switch (arm) {
      case IndependentModelArm.Control:
        return 'Indep_Openness_Registration'
      case IndependentModelArm.Haystaq:
        return 'Indep_Openness_Haystaq'
      case IndependentModelArm.StateLeg:
        return this.stateLegColumn(campaign)
    }
  }

  private async stateLegColumn(campaign: Campaign): Promise<AffinityColumn> {
    const now = new Date()
    const cached = this.scenarioCache.get(campaign.id)
    if (cached && isAfter(cached.expiresAt, now)) return cached.column

    const raceId = campaign.details?.raceId?.trim()
    const context = raceId
      ? await this.elections.fetchCampaignStrategyContext(raceId)
      : null
    const column = stateLegAffinityColumn({
      candidates: context?.candidates ?? [],
      numberOfSeats: context?.number_of_seats ?? null,
      partisanType: context?.partisan_type,
      gpCandidateParty: campaign.details?.party,
    })
    this.scenarioCache.set(campaign.id, {
      column,
      expiresAt: addMinutes(now, SCENARIO_CACHE_MINUTES),
    })
    return column
  }
}
