import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  OrdinanceListResponseSchema,
  OrdinanceSchema,
} from '@goodparty_org/contracts'
import { ReqElectedOffice } from 'src/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from 'src/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { ElectedOffice } from '../../generated/prisma'
import { OrdinancesService } from '../services/ordinances.service'
import {
  CreateOrdinanceDto,
  OrdinanceSlugParamDto,
  SaveClarifyAnswerDto,
  UpdateOrdinanceDto,
} from '../schemas/ordinances.schema'

@Controller('ordinances')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OrdinanceFlowController {
  constructor(private readonly ordinances: OrdinancesService) {}

  @Post()
  @UseElectedOffice()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(OrdinanceSchema)
  async create(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body() body: CreateOrdinanceDto,
  ) {
    return this.ordinances.create(electedOffice, body)
  }

  @Get()
  @UseElectedOffice()
  @McpTool({
    description:
      "List the elected office's ordinances (grouped counts by status).",
  })
  @ResponseSchema(OrdinanceListResponseSchema)
  async list(@ReqElectedOffice() electedOffice: ElectedOffice) {
    return this.ordinances.list(electedOffice)
  }

  @Get(':slug')
  @UseElectedOffice()
  @McpTool({
    description: 'Read a single ordinance by slug for the elected office.',
  })
  @ResponseSchema(OrdinanceSchema)
  async detail(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { slug }: OrdinanceSlugParamDto,
  ) {
    return this.ordinances.getBySlug(electedOffice, slug)
  }

  @Post(':slug/clarify-answers')
  @UseElectedOffice()
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(OrdinanceSchema)
  async saveClarifyAnswer(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { slug }: OrdinanceSlugParamDto,
    @Body() body: SaveClarifyAnswerDto,
  ) {
    return this.ordinances.appendClarifyAnswer(electedOffice, slug, body)
  }

  @Post(':slug/quality-report')
  @UseElectedOffice()
  @ResponseSchema(OrdinanceSchema)
  async generateQualityReport(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { slug }: OrdinanceSlugParamDto,
  ) {
    return this.ordinances.generateQualityReport(electedOffice, slug)
  }

  @Patch(':slug')
  @UseElectedOffice()
  @ResponseSchema(OrdinanceSchema)
  async update(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { slug }: OrdinanceSlugParamDto,
    @Body() body: UpdateOrdinanceDto,
  ) {
    return this.ordinances.update(electedOffice, slug, body)
  }

  @Delete(':slug')
  @UseElectedOffice()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param() { slug }: OrdinanceSlugParamDto,
  ) {
    await this.ordinances.softDelete(electedOffice, slug)
  }
}
