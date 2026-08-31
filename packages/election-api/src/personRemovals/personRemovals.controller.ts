import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common'
import { PersonRemovalsService } from './personRemovals.service'
import {
  ClearPersonRemovalParamsDto,
  SetPersonRemovalDto,
} from './personRemovals.schema'

// Write surface for gp-api's admin removal control. No guard decorators needed:
// M2MAuthGuard is global default-deny, so these are already restricted to
// machine callers holding a valid token.
@Controller('person-removals')
export class PersonRemovalsController {
  constructor(private readonly personRemovals: PersonRemovalsService) {}

  // Idempotent: re-filing an existing removal refreshes the reason rather than
  // conflicting, so a retry from gp-api is always safe.
  @Post()
  @HttpCode(HttpStatus.OK)
  async setRemoval(@Body() body: SetPersonRemovalDto) {
    const removal = await this.personRemovals.setRemoval(
      body.personId,
      body.reason,
    )
    return { personId: removal.personId, removed: true }
  }

  // Also idempotent: clearing an absent removal reports the end state rather
  // than 404ing, so gp-api does not have to track whether one existed.
  @Delete(':personId')
  @HttpCode(HttpStatus.OK)
  async clearRemoval(@Param() params: ClearPersonRemovalParamsDto) {
    await this.personRemovals.clearRemoval(params.personId)
    return { personId: params.personId, removed: false }
  }
}
