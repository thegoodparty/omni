import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import {
  AdminExtendPlanSchema,
  AdminPlanRefundEligibilitySchema,
  AdminRefundPlanResponseSchema,
  AdminSetPlanSchema,
  CampaignPlanStateSchema,
} from '@goodparty_org/contracts'
import { createZodDto, ZodValidationPipe } from 'nestjs-zod'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { AdminCampaignsService } from './adminCampaigns.service'

class AdminSetPlanDto extends createZodDto(AdminSetPlanSchema) {}
class AdminExtendPlanDto extends createZodDto(AdminExtendPlanSchema) {}

// Its own controller because AdminCampaignsController is locked to
// UserRole.admin by the global RolesGuard, which turns a machine caller away.
@Controller('admin/campaigns')
@UsePipes(ZodValidationPipe)
@UseGuards(M2MOnly)
export class AdminCampaignPlanController {
  constructor(private readonly adminCampaigns: AdminCampaignsService) {}

  @Post(':id/plan')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(CampaignPlanStateSchema)
  setPlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdminSetPlanDto,
  ) {
    return this.adminCampaigns.setPlan(id, body)
  }

  @Post(':id/plan/extend')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(CampaignPlanStateSchema)
  extendPlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdminExtendPlanDto,
  ) {
    return this.adminCampaigns.extendPlan(id, body)
  }

  @Get(':id/plan/refund-eligibility')
  @ResponseSchema(AdminPlanRefundEligibilitySchema)
  getRefundEligibility(@Param('id', ParseIntPipe) id: number) {
    return this.adminCampaigns.getRefundEligibility(id)
  }

  @Post(':id/plan/refund')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(AdminRefundPlanResponseSchema)
  refundPlan(@Param('id', ParseIntPipe) id: number) {
    return this.adminCampaigns.refundPlan(id)
  }
}
