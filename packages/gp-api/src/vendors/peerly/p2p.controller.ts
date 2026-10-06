import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { FastifyReply } from 'fastify'
import { Campaign, PhoneListBuildStatus } from '../../generated/prisma'
import { ReqCampaign } from '../../campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '../../campaigns/decorators/UseCampaign.decorator'
import { PeerlyPhoneListCaptureService } from './services/peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from './services/peerlyPhoneList.service'
import { PhoneListState } from './peerly.types'
import {
  CheckPhoneListStatusAcceptedResponseDto,
  CheckPhoneListStatusResponseDto,
} from './schemas/p2pPhoneListStatus.schema'
import {
  CheckPhoneListBuildStatusFailedResponseDto,
  CheckPhoneListBuildStatusReadyResponseDto,
} from './schemas/p2pPhoneListBuildStatus.schema'
import { P2pPhoneListRequestSchema } from './schemas/p2pPhoneListRequest.schema'
import { P2pPhoneListResponseSchema } from './schemas/p2pPhoneListResponse.schema'
import { P2pPhoneListUploadService } from './services/p2pPhoneListUpload.service'
import { PinoLogger } from 'nestjs-pino'

@Controller('p2p')
@UsePipes(ZodValidationPipe)
export class P2pController {
  constructor(
    private readonly peerlyPhoneListService: PeerlyPhoneListService,
    private readonly peerlyPhoneListCapture: PeerlyPhoneListCaptureService,
    private readonly p2pPhoneListUploadService: P2pPhoneListUploadService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(P2pController.name)
  }

  @Get('phone-list/:token/status')
  @UseCampaign()
  async checkPhoneListStatus(
    @ReqCampaign() campaign: Campaign,
    @Param('token') token: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<
    CheckPhoneListStatusResponseDto | CheckPhoneListStatusAcceptedResponseDto
  > {
    // The token is client-supplied: without this ownership check any
    // authenticated campaign could poll (and stamp) another campaign's
    // phone list. Outside the try so the 404 isn't rewritten to a 502.
    const capturedList = await this.peerlyPhoneListCapture.findFirst({
      where: { token, campaignId: campaign.id },
    })
    if (!capturedList) {
      throw new NotFoundException('Phone list not found')
    }
    try {
      const statusResponse =
        await this.peerlyPhoneListService.checkPhoneListStatus(token)

      if (!statusResponse) {
        res.status(HttpStatus.ACCEPTED)
        return {
          message: 'Phone list status is not yet available. Please try again.',
        }
      }

      if (statusResponse.Data.list_state !== PhoneListState.ACTIVE) {
        const status = statusResponse.Data.list_state || 'unknown'
        res.status(HttpStatus.ACCEPTED)
        return {
          message:
            status === PhoneListState.PROCESSING
              ? 'Phone list is still processing. Please try again in a few moments.'
              : `Phone list is not ready. Current status: ${status}`,
        }
      }

      const listId = statusResponse.Data.list_id
      if (!listId) {
        throw new BadGatewayException(
          'Phone list is active but no list_id was returned',
        )
      }

      const detailsResponse =
        await this.peerlyPhoneListService.getPhoneListDetails(listId)

      // First-seen-ready stamp: guarded on peerlyListId IS NULL inside the
      // capture service, so a repeat poll after the first success is a
      // no-op rather than a re-write. A stamp failure must not 502 the
      // successful poll — an unstamped capture row degrades to the
      // materialization fallback, which is the designed behavior.
      await this.peerlyPhoneListCapture
        .stampPeerlyListId(token, listId)
        .catch((err: Error) =>
          this.logger.warn(
            { err, token, listId },
            'Failed to stamp peerlyListId; capture row stays unstamped',
          ),
        )

      return {
        phoneListId: listId,
        leadsLoaded: detailsResponse.leads_loaded,
        // Already fetched via the ownership check above — the capture row
        // is stamped with these at upload time (ENG-10800/ENG-10801), so no
        // extra query is needed to surface them (ENG-10808).
        excludedOptedOutCount: capturedList.excludedOptedOutCount,
        excludedDuplicatePhoneCount: capturedList.excludedDuplicatePhoneCount,
      }
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error
      }

      this.logger.error({ error }, 'Failed to check phone list status')
      throw new BadGatewayException('Failed to check phone list status.')
    }
  }

  @Post('phone-list')
  @UseCampaign()
  async uploadPhoneList(
    @ReqCampaign() campaign: Campaign,
    @Body() request: P2pPhoneListRequestSchema,
  ): Promise<P2pPhoneListResponseSchema> {
    try {
      const { token, buildId } =
        await this.p2pPhoneListUploadService.uploadPhoneList(campaign, request)

      return { token, buildId }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      this.logger.error({ error }, 'Failed to upload phone list')
      throw new BadGatewayException('Failed to upload phone list.')
    }
  }

  // Additive counterpart to the token-status route above, keyed on the
  // PeerlyPhoneList row id instead of the Peerly token — the handle a
  // caller has from the moment the POST is accepted, before a token exists.
  // Same Peerly ACTIVE resolution + peerlyListId stamping; also resolves
  // the two build-only states the token route never sees: an in-progress
  // build with no token yet, and a build that failed before ever reaching
  // Peerly.
  @Get('phone-list/build/:buildId/status')
  @UseCampaign()
  async checkPhoneListBuildStatus(
    @ReqCampaign() campaign: Campaign,
    @Param('buildId') buildId: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<
    | CheckPhoneListBuildStatusReadyResponseDto
    | CheckPhoneListStatusAcceptedResponseDto
    | CheckPhoneListBuildStatusFailedResponseDto
  > {
    // Ownership check first, same reasoning as the token route: buildId is
    // an opaque id a caller could guess/enumerate.
    const build = await this.peerlyPhoneListCapture.findFirst({
      where: { id: buildId, campaignId: campaign.id },
    })
    if (!build) {
      throw new NotFoundException('Phone list build not found')
    }

    if (build.buildStatus === PhoneListBuildStatus.failed) {
      return {
        buildStatus: 'failed',
        buildError: build.buildError ?? 'Phone list build failed',
      }
    }

    if (!build.token) {
      // queued/building: the synchronous build hasn't reached Peerly yet.
      res.status(HttpStatus.ACCEPTED)
      return {
        message: 'Phone list build is still in progress. Please try again.',
      }
    }

    try {
      const statusResponse =
        await this.peerlyPhoneListService.checkPhoneListStatus(build.token)

      if (!statusResponse) {
        res.status(HttpStatus.ACCEPTED)
        return {
          message: 'Phone list status is not yet available. Please try again.',
        }
      }

      if (statusResponse.Data.list_state !== PhoneListState.ACTIVE) {
        const status = statusResponse.Data.list_state || 'unknown'
        res.status(HttpStatus.ACCEPTED)
        return {
          message:
            status === PhoneListState.PROCESSING
              ? 'Phone list is still processing. Please try again in a few moments.'
              : `Phone list is not ready. Current status: ${status}`,
        }
      }

      const listId = statusResponse.Data.list_id
      if (!listId) {
        throw new BadGatewayException(
          'Phone list is active but no list_id was returned',
        )
      }

      const detailsResponse =
        await this.peerlyPhoneListService.getPhoneListDetails(listId)

      // Same guarded stamp the token route uses — idempotent across both
      // routes, whichever sees ACTIVE first.
      await this.peerlyPhoneListCapture
        .stampPeerlyListId(build.token, listId)
        .catch((err: Error) =>
          this.logger.warn(
            { err, buildId, listId },
            'Failed to stamp peerlyListId; build row stays unstamped',
          ),
        )

      return {
        phoneListId: listId,
        leadsLoaded: detailsResponse.leads_loaded,
        excludedOptedOutCount: build.excludedOptedOutCount,
        excludedDuplicatePhoneCount: build.excludedDuplicatePhoneCount,
      }
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error
      }
      this.logger.error({ error }, 'Failed to check phone list build status')
      throw new BadGatewayException('Failed to check phone list status.')
    }
  }
}
