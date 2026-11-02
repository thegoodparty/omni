import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { RacesService } from '@/elections/services/races.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  BallotReadyPositionLevelSchema,
  RaceListItem,
  TestModeElectionPreset,
} from '@goodparty_org/contracts'
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import {
  addDays,
  addYears,
  format,
  startOfDay,
  subDays,
  subMonths,
} from 'date-fns'
import { Campaign, Prisma, User } from '../../generated/prisma'
import { resolveFixtureRace } from '../util/fixtureRace.util'

// Same default office the e2e suite provisions against — a live BallotReady
// office in the dev election database with voter rows in the dev people-db.
export const DEFAULT_RACE = {
  zip: '82001',
  office: 'Cheyenne City Council - Ward 1',
}
export const DEFAULT_CUSTOM_POSITION_NAME = 'Test City Council'
export const DEFAULT_ELECTION_PRESET: TestModeElectionPreset = 'in_8_weeks'

const DATE_FORMAT = 'yyyy-MM-dd'

export type RaceSelection = { zip: string; office: string }

// The one place a preset becomes a date, always off the server's clock.
// `in_8_weeks` sits well outside the 19-day texting cutoff.
export const electionPresetDate = (
  preset: TestModeElectionPreset,
  today: Date = startOfDay(new Date()),
): string => {
  switch (preset) {
    case 'in_8_weeks':
      return format(addDays(today, 56), DATE_FORMAT)
    case 'in_1_week':
      return format(addDays(today, 7), DATE_FORMAT)
    case 'passed_unanswered':
    case 'passed_lost':
      return format(subDays(today, 14), DATE_FORMAT)
    case 'passed_won':
      return format(subDays(today, 30), DATE_FORMAT)
  }
}

// Org-state transitions shared by the dev-only test fixtures and the staff
// Test mode module. Every path here composes existing services with the
// real-user side effects bypassed: no HubSpot, no emails, no Slack.
@Injectable()
export class StateTransitionsService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly electedOffice: ElectedOfficeService,
    private readonly races: RacesService,
    private readonly organizations: OrganizationsService,
  ) {}

  async findRace(race?: RaceSelection): Promise<RaceListItem> {
    const zipcode = race?.zip ?? DEFAULT_RACE.zip
    const officeName = race?.office ?? DEFAULT_RACE.office

    const match = await resolveFixtureRace(officeName, (timeframe) =>
      this.races.getRacesByZip({ zipcode, timeframe }),
    )
    if (!match) {
      throw new BadRequestException(
        `No race named "${officeName}" found for zip ${zipcode}`,
      )
    }
    return match
  }

  // `testMode` stamps the organization as a staff test org inside the same
  // insert transaction, so no reader ever sees it unmarked. `launch: false`
  // leaves the campaign in onboarding instead of launching it. The election
  // date comes from the preset, never from the race, so launch sees it.
  async createLaunchedCampaign(
    user: User,
    race?: RaceSelection,
    opts: {
      testMode?: boolean
      launch?: boolean
      election?: TestModeElectionPreset
    } = {},
  ): Promise<Campaign> {
    const match = await this.findRace(race)

    const ballotLevel = BallotReadyPositionLevelSchema.safeParse(
      match.position.level.toUpperCase(),
    ).data
    const details: PrismaJson.CampaignDetails = {
      raceId: match.id,
      state: match.position.state,
      electionDate: electionPresetDate(
        opts.election ?? DEFAULT_ELECTION_PRESET,
      ),
      ...(ballotLevel ? { ballotLevel } : {}),
    }

    // outerTx makes CRM tracking the caller's responsibility (see
    // createForUser) — fixture and test-mode orgs must never reach HubSpot.
    const campaign = await this.campaigns.client.$transaction(async (tx) => {
      const created = await this.campaigns.createForUser(
        user,
        { details },
        { ballotReadyPositionId: match.brPositionId },
        undefined,
        tx,
      )
      if (opts.testMode) {
        await tx.organization.update({
          where: { slug: created.organizationSlug },
          data: { testModeCreatedAt: new Date() },
        })
      }
      return created
    })

    if (opts.launch === false) {
      return campaign
    }

    await this.campaigns.updateJsonFields(
      campaign.id,
      { details: { otherParty: 'Independent', pledged: true } },
      false,
    )

    const current = await this.campaigns.findUnique({
      where: { id: campaign.id },
    })
    if (!current) {
      throw new ConflictException('Fixture campaign vanished mid-create')
    }
    await this.campaigns.launch(current, { trackCampaign: false })
    return current
  }

  // Rewrites the campaign's election into the preset's state. `passed_won`
  // only writes the win markers: the caller links the elected office first,
  // the way the election-result flow does.
  async applyElectionPreset(
    campaignId: number,
    preset: TestModeElectionPreset,
  ): Promise<string> {
    const electionDate = electionPresetDate(preset)
    switch (preset) {
      case 'in_8_weeks':
      case 'in_1_week':
        await this.rewriteCampaignJson(campaignId, ({ details, data }) => {
          delete details.wonGeneral
          delete details.primaryElectionDate
          return {
            details: { ...details, electionDate },
            data,
            scalars: { didWin: null, primaryResult: null },
          }
        })
        break
      case 'passed_unanswered':
      case 'passed_lost':
        await this.rewriteCampaignJson(campaignId, ({ details, data }) => {
          delete details.wonGeneral
          return {
            details: {
              ...details,
              electionDate,
              ...(preset === 'passed_lost' ? { wonGeneral: false } : {}),
            },
            data,
            scalars: { didWin: null },
          }
        })
        break
      case 'passed_won':
        await this.rewriteCampaignJson(campaignId, ({ details, data }) => ({
          details: { ...details, electionDate, wonGeneral: true },
          data,
        }))
        break
    }
    return electionDate
  }

  // updateJsonFields deep-merges and cannot delete keys, so the presets that
  // drop `wonGeneral` or the onboarding markers rebuild the columns under the
  // same row lock it takes (see campaigns/AGENTS.md on JSON columns).
  async rewriteCampaignJson(
    campaignId: number,
    rewrite: (row: {
      details: PrismaJson.CampaignDetails
      data: PrismaJson.CampaignData
    }) => {
      details: PrismaJson.CampaignDetails
      data: PrismaJson.CampaignData
      scalars?: Pick<
        Prisma.CampaignUncheckedUpdateInput,
        'isActive' | 'didWin' | 'primaryResult'
      >
    },
  ) {
    await this.campaigns.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM campaign WHERE id = ${campaignId} FOR UPDATE`
      const row = await tx.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: { details: true, data: true },
      })
      const next = rewrite({
        details: { ...row.details },
        data: { ...row.data },
      })
      await tx.campaign.update({
        where: { id: campaignId },
        data: { details: next.details, data: next.data, ...next.scalars },
      })
    })
  }

  async createElectedOffice(
    user: User,
    serve?: { positionId?: string; termStartDate?: Date; termEndDate?: Date },
  ) {
    const termStartDate =
      serve?.termStartDate ?? subMonths(startOfDay(new Date()), 6)
    const termEndDate = serve?.termEndDate ?? addYears(termStartDate, 4)

    // A bound position triggers the EO-created agent dispatch hooks, but
    // createAndEnqueueRun skips test-user orgs unconditionally, so binding a
    // fixture never causes agent spend.
    return this.electedOffice.create({
      userId: user.id,
      termStartDate,
      termEndDate,
      onboardingCompletedAt: new Date(),
      selfReported: true,
      orgData: {
        positionId: serve?.positionId ?? null,
        customPositionName: serve?.positionId
          ? null
          : DEFAULT_CUSTOM_POSITION_NAME,
        overrideDistrictId: null,
      },
    })
  }

  async promoteWonRace(user: User, campaign: Campaign) {
    const org = campaign.organizationSlug
      ? await this.organizations.findUnique({
          where: { slug: campaign.organizationSlug },
        })
      : null

    const termStartDate = startOfDay(new Date())
    const office = await this.electedOffice.create({
      userId: user.id,
      campaignId: campaign.id,
      termStartDate,
      termEndDate: addYears(termStartDate, 4),
      onboardingCompletedAt: new Date(),
      selfReported: true,
      orgData: {
        positionId: org?.positionId ?? null,
        customPositionName: org?.customPositionName ?? null,
        overrideDistrictId: org?.overrideDistrictId ?? null,
      },
    })

    // Win markers last, with a past election date — mirrors the user-facing
    // election-result flow, and a past date can never trip the
    // stale-election-result reset in updateJsonFields.
    await this.campaigns.updateJsonFields(
      campaign.id,
      {
        details: {
          wonGeneral: true,
          electionDate: format(subMonths(new Date(), 1), 'yyyy-MM-dd'),
        },
      },
      false,
    )

    return office
  }
}
