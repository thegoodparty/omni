import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { OfficeHolderFilterDto } from '@/electionDb/officeHolders/officeHolders.schema'
import { OfficeHoldersService } from '@/electionDb/officeHolders/officeHolders.service'
import { PositionLevel } from '@/generated/election-prisma'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'

// Every field is optional because `?columns=` returns a partial row, and the
// schema is here to STRIP rather than to require: an ETL-added column reaches
// this public-facing surface only once it is declared here.
const officeHolderScalarsSchema = z.object({
  id: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  brOfficeHolderId: z.number().nullable().optional(),
  positionName: z.string().nullable().optional(),
  normalizedPositionName: z.string().nullable().optional(),
  officeTitle: z.string().nullable().optional(),
  partyNames: z.array(z.string()).optional(),
  startAt: z.date().nullable().optional(),
  endAt: z.date().nullable().optional(),
  termDateSpecificity: z.string().nullable().optional(),
  isCurrent: z.boolean().nullable().optional(),
  isAppointed: z.boolean().nullable().optional(),
  isVacant: z.boolean().nullable().optional(),
  numberOfSeats: z.number().nullable().optional(),
  nextElectionDate: z.date().nullable().optional(),
  mailingAddressLine1: z.string().nullable().optional(),
  mailingAddressLine2: z.string().nullable().optional(),
  mailingCity: z.string().nullable().optional(),
  mailingState: z.string().nullable().optional(),
  mailingZip: z.string().nullable().optional(),
  officePhone: z.string().nullable().optional(),
  officeEmail: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  facebookUrl: z.string().nullable().optional(),
  twitterUrl: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  subAreaName: z.string().nullable().optional(),
  subAreaValue: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  geoId: z.string().nullable().optional(),
  mtfcc: z.string().nullable().optional(),
  personId: z.string().optional(),
  positionId: z.string().nullable().optional(),
})

const positionSchema = z.object({
  id: z.string(),
  brDatabaseId: z.string(),
  brPositionId: z.string(),
  state: z.string(),
  name: z.string(),
  isWinIcp: z.boolean().nullable(),
  isServeIcp: z.boolean().nullable(),
  salary: z.string().nullable(),
  districtId: z.string().nullable(),
  level: z.enum(PositionLevel).nullable(),
})

export const officeHolderListResponseSchema = z.array(
  officeHolderScalarsSchema.extend({
    Position: positionSchema.nullable().optional(),
  }),
)

@Controller('elections/officeholders')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ElectionOfficeHoldersController {
  constructor(private readonly officeHoldersService: OfficeHoldersService) {}

  @UseGuards(M2MOnly)
  @Get()
  @ResponseSchema(officeHolderListResponseSchema)
  async getOfficeHolders(@Query() filterDto: OfficeHolderFilterDto) {
    return this.officeHoldersService.getOfficeHolders(filterDto)
  }
}
