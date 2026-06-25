import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common'
import { ContentService } from './services/content.service'
import { ContentType } from '../generated/prisma'
import {
  CONTENT_TYPE_MAP,
  InferredContentTypes,
} from './CONTENT_TYPE_MAP.const'
import { PublicAccess } from '../authentication/decorators/PublicAccess.decorator'
import { AdminOrM2MGuard } from '../authentication/guards/AdminOrM2M.guard'

// @PublicAccess is applied per-route (only the read endpoint) rather than at the
// class level so the destructive sync route is NOT public — it reconciles
// Content rows (create/update/delete, incl. the AI chat system prompt) and must
// require an admin user or M2M (cron) token (CWE-862).
@Controller('content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get('type/:type')
  @PublicAccess()
  findByType(@Param('type') type: ContentType | InferredContentTypes) {
    if (!CONTENT_TYPE_MAP[type]) {
      throw new BadRequestException(`${type} is not a valid content type`)
    }
    return this.contentService.findByType({ type })
  }

  @Get('sync')
  @UseGuards(AdminOrM2MGuard)
  async sync() {
    const { entries, createEntries, updateEntries, deletedEntries } =
      await this.contentService.syncContent()

    return {
      entriesCount: entries.length,
      createEntriesCount: createEntries.length,
      updateEntriesCount: updateEntries.length,
      deletedEntriesCount: deletedEntries.length,
    }
  }
}
