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
  OnboardingPriorityOptionsSchema,
  PriorityReadStatusSchema,
  PriorityResultsSchema,
  PrioritySchema,
  parsePriorityStatus,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from 'src/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from 'src/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { z } from 'zod'
import { ElectedOffice, PrioritySource, User } from '../generated/prisma'
import {
  CreatePriorityDto,
  PriorityIdParamDto,
  SetOnboardingPrioritiesDto,
  UpdatePriorityDto,
} from './schemas/priority.schema'
import { PriorityStatusResponseSchema } from './schemas/priorityStatus.schema'
import { PrioritiesService } from './services/priorities.service'
import { PriorityOnboardingService } from './services/priorityOnboarding.service'
import { PriorityResultsService } from './services/priorityResults.service'
import { currentStepOf, priorityToApi } from './util/priority.util'

@Controller('priorities')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
@UseElectedOffice()
export class PrioritiesController {
  constructor(
    private readonly prioritiesService: PrioritiesService,
    private readonly onboarding: PriorityOnboardingService,
    private readonly priorityResults: PriorityResultsService,
    private readonly features: FeaturesService,
  ) {}

  @Get()
  @McpTool({ description: 'List priorities for the elected office.' })
  @ResponseSchema(z.array(PrioritySchema))
  async list(@ReqElectedOffice() electedOffice: ElectedOffice) {
    const priorities = await this.prioritiesService.listActive(electedOffice.id)
    return priorities.map(priorityToApi)
  }

  @Get('onboarding')
  @ResponseSchema(OnboardingPriorityOptionsSchema)
  async onboardingOptions(@ReqElectedOffice() electedOffice: ElectedOffice) {
    return { options: await this.onboarding.options(electedOffice) }
  }

  @Put('onboarding')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOnboarding(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body() body: SetOnboardingPrioritiesDto,
  ) {
    await this.onboarding.set(electedOffice, body)
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

  @Get(':id/results')
  @ResponseSchema(PriorityResultsSchema)
  async results(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @ReqUser() user: User,
    @Param() { id }: PriorityIdParamDto,
  ) {
    // 404 rather than 403 when the flag is off: a surface the user has not
    // been rolled out to should not advertise that it exists.
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_CITIZEN_PANELS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
    return this.priorityResults.resultsFor(electedOffice, id)
  }

  @Get(':id/read-status')
  @ResponseSchema(PriorityReadStatusSchema)
  async readStatus(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @ReqUser() user: User,
    @Param() { id }: PriorityIdParamDto,
  ) {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_CITIZEN_PANELS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
    return this.priorityResults.readStatusFor(electedOffice, id)
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
