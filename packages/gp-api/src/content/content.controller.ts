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

  // Admin or M2M rather than @Roles(admin): an M2M token carries no user, and
  // the deploy-time caller is a machine. Preview deploys run the sync as their
  // own process (`dist/content/syncContent.cli.js`), so this route exists for
  // manual re-syncs only.
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
