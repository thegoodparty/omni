import { Controller, Get } from '@nestjs/common'
import { PublicAccess } from '../authentication/decorators/PublicAccess.decorator'

@Controller('version')
export class VersionController {
  @PublicAccess()
  @Get()
  getVersion() {
    return { commit: process.env.GIT_SHA ?? 'unknown' }
  }
}
