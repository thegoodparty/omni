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
import { PrioritySchema, parsePriorityStatus } from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqElectedOffice } from 'src/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from 'src/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { z } from 'zod'
import { ElectedOffice, PrioritySource } from '../generated/prisma'
import {
  CreatePriorityDto,
  PriorityIdParamDto,
  UpdatePriorityDto,
} from './schemas/priority.schema'
import { PriorityStatusResponseSchema } from './schemas/priorityStatus.schema'
import { PrioritiesService } from './services/priorities.service'
import { currentStepOf, priorityToApi } from './util/priority.util'

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
    return priorities.map(priorityToApi)
  }

  @Get(':id/status')
  @ResponseSchema(PriorityStatusResponseSchema)
  async status(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: PriorityIdParamDto,
  ) {
    const priority = await this.prioritiesService.findFirst({
      where: { id, electedOfficeId: electedOffice.id, archivedAt: null },
    })
    if (!priority) {
      throw new NotFoundException('Priority not found')
    }
    return {
      status: parsePriorityStatus(priority.status),
      currentStep: currentStepOf(priority),
      nextAction: priority.nextAction,
    }
  }

  @Get(':id')
  @ResponseSchema(PrioritySchema)
  async get(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: PriorityIdParamDto,
  ) {
    const priority = await this.prioritiesService.findFirst({
      where: { id, electedOfficeId: electedOffice.id, archivedAt: null },
    })
    if (!priority) {
      throw new NotFoundException('Priority not found')
    }
    return priorityToApi(priority)
  }

  @Post()
  @ResponseSchema(PrioritySchema)
  async create(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body() body: CreatePriorityDto,
  ) {
    const created = await this.prioritiesService.create(
      electedOffice.id,
      { title: body.title, description: body.description },
      PrioritySource.user_stated,
      'priorities_page',
    )
    return priorityToApi(created)
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
    })
    if (!updated) {
      throw new NotFoundException('Priority not found')
    }
    return priorityToApi(updated)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { id }: PriorityIdParamDto,
  ) {
    const archived = await this.prioritiesService.archive(
      id,
      electedOffice.id,
      'priorities_page',
    )
    if (!archived) {
      throw new NotFoundException('Priority not found')
    }
  }
}
