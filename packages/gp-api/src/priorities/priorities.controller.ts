import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import {
  Priority as PriorityDto,
  PrioritySchema,
} from '@goodparty_org/contracts'
import { parseISO } from 'date-fns'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqElectedOffice } from 'src/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from 'src/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { z } from 'zod'
import { ElectedOffice, Priority, PrioritySource } from '../generated/prisma'
import { toDateOnlyString } from 'src/shared/util/date.util'
import {
  CreatePriorityDto,
  PriorityIdParamDto,
  UpdatePriorityDto,
} from './schemas/priority.schema'
import { PrioritiesService } from './services/priorities.service'

const toApi = (record: Priority): PriorityDto => ({
  id: record.id,
  electedOfficeId: record.electedOfficeId,
  title: record.title,
  description: record.description,
  source: record.source,
  sourceCampaignPositionId: record.sourceCampaignPositionId,
  targetDate: toDateOnlyString(record.targetDate) ?? null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})

@Controller('priorities')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
@UseElectedOffice()
export class PrioritiesController {
  constructor(private readonly prioritiesService: PrioritiesService) {}

  @Get()
  @McpTool({ description: 'List priorities for the elected office.' })
  @ResponseSchema(z.array(PrioritySchema))
  async list(@ReqElectedOffice() electedOffice: ElectedOffice) {
    const priorities = await this.prioritiesService.listActive(electedOffice.id)
    return priorities.map(toApi)
  }

  @Post()
  @ResponseSchema(PrioritySchema)
  async create(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body() body: CreatePriorityDto,
  ) {
    const created = await this.prioritiesService.create(
      electedOffice.id,
      {
        title: body.title,
        description: body.description,
        targetDate: body.targetDate ? parseISO(body.targetDate) : null,
      },
      PrioritySource.user_stated,
    )
    return toApi(created)
  }

  @Put(':id')
  @ResponseSchema(PrioritySchema)
  async update(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: PriorityIdParamDto,
    @Body() body: UpdatePriorityDto,
  ) {
    const updated = await this.prioritiesService.update(id, electedOffice.id, {
      title: body.title,
      description: body.description,
      targetDate:
        body.targetDate === undefined
          ? undefined
          : body.targetDate
            ? parseISO(body.targetDate)
            : null,
    })
    if (!updated) {
      throw new NotFoundException('Priority not found')
    }
    return toApi(updated)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: PriorityIdParamDto,
  ) {
    const archived = await this.prioritiesService.archive(id, electedOffice.id)
    if (!archived) {
      throw new NotFoundException('Priority not found')
    }
  }
}
