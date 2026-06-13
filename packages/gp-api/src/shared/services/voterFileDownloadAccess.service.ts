import { OrgDistrict } from '@/organizations/organizations.types'
import { IS_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { Inject, OnModuleInit } from '@nestjs/common'
import { Campaign, User } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { BallotReadyPositionLevel } from '@goodparty_org/contracts'

export class VoterFileDownloadAccessService implements OnModuleInit {
  @Inject()
  private readonly logger!: PinoLogger

  constructor(private readonly slack: SlackService) {}

  onModuleInit() {
    this.logger.setContext(VoterFileDownloadAccessService.name)
  }

  canDownload(
    campaign?: Campaign,
    district?: OrgDistrict | null,
    // The server-determined race level (the election-api position level). It is
    // authoritative because — unlike campaign.details.ballotLevel — the user
    // cannot edit it. The download gate MUST use it: otherwise a FEDERAL/STATE
    // candidate could set details.ballotLevel to a local level to unlock the
    // voter file. Falls back to the declared level only when there is no
    // position (manual-entry campaigns have no authoritative race level).
    authoritativeBallotLevel?: BallotReadyPositionLevel | null,
  ) {
    if (!campaign) return false

    const ballotLevel =
      authoritativeBallotLevel ?? campaign.details?.ballotLevel
    const hasElectionData = district?.l2Type && district?.l2Name

    const canDownload = Boolean(
      (ballotLevel && ballotLevel !== 'FEDERAL' && ballotLevel !== 'STATE') ||
      (ballotLevel &&
        (ballotLevel === 'FEDERAL' || ballotLevel === 'STATE') &&
        campaign.canDownloadFederal) ||
      hasElectionData,
    )

    if (!canDownload) {
      this.logger.info(
        { id: campaign.id },
        'Campaign is not eligible for download.',
      )
    }

    return canDownload
  }

  async downloadAccessAlert(
    campaign: Campaign,
    user: User,
    district?: OrgDistrict | null,
    authoritativeBallotLevel?: BallotReadyPositionLevel | null,
  ) {
    const canDownload = !campaign
      ? false
      : await this.canDownload(campaign, district, authoritativeBallotLevel)
    if (!canDownload) {
      // alert Jared and Rob.
      const alertSlackMessage = `<@U01AY0VQFPE> and <@U03RY5HHYQ5>`
      await this.slack.message(
        {
          text: `Campaign ${campaign.slug} has been upgraded to Pro but the voter file is not available. Email: ${user.email}\nvisit https://goodparty.org/admin/pro-no-voter-file to see all users without L2 data\n${alertSlackMessage}`,
        },
        IS_PROD_DEPLOY ? SlackChannel.botPolitics : SlackChannel.botDev,
      )
    }
  }
}
