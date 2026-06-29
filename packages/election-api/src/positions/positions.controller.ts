import { Controller, Get, Param, Query } from '@nestjs/common'
import type { NextElectionForPosition } from '@goodparty_org/contracts'
import { PositionsService } from './positions.service'
import {
  GetPositionByBrIdParamsDTO,
  GetPositionByBrIdQueryDTO,
  GetPositionByIdParamsDTO,
} from './positions.schema'
import { PositionWithOptionalDistrict } from './positions.types'

@Controller('positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get('by-ballotready-id/:brPositionId')
  async getPositionByBallotReadyId(
    @Param() params: GetPositionByBrIdParamsDTO,
    @Query() query: GetPositionByBrIdQueryDTO,
  ): Promise<PositionWithOptionalDistrict> {
    const { includeDistrict, electionDate, includeTurnout, includeFilingFee } =
      query
    return this.positions.getPositionByBallotReadyId({
      brPositionId: params.brPositionId,
      includeDistrict: includeDistrict,
      electionDate: electionDate,
      includeTurnout: includeTurnout,
      includeFilingFee: includeFilingFee,
    })
  }

  @Get(':id/next-election')
  async getNextElectionForPosition(
    @Param() params: GetPositionByIdParamsDTO,
  ): Promise<NextElectionForPosition> {
    return this.positions.getNextElectionForPosition(params.id)
  }

  @Get(':id')
  async getPositionById(
    @Param() params: GetPositionByIdParamsDTO,
    @Query() query: GetPositionByBrIdQueryDTO,
  ): Promise<PositionWithOptionalDistrict> {
    const { includeDistrict, electionDate, includeTurnout, includeFilingFee } =
      query
    return this.positions.getPositionById({
      id: params.id,
      includeDistrict: includeDistrict,
      electionDate: electionDate,
      includeTurnout: includeTurnout,
      includeFilingFee: includeFilingFee,
    })
  }
}
