import { applyDecorators, UseGuards } from '@nestjs/common'
import { UseEngagementContextGuard } from '../guards/UseEngagementContext.guard'

export const UseEngagementContext = () =>
  applyDecorators(UseGuards(UseEngagementContextGuard))
