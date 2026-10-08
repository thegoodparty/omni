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
import { CandidacyFilterDto } from '@/electionDb/candidacies/candidacies.schema'
import { CandidaciesService } from '@/electionDb/candidacies/candidacies.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'

// Every field is nullish because `?columns=`/`?raceColumns=` let the caller
// select an arbitrary subset, so any key may legitimately be absent. The
// schema earns its keep in the other direction: `.parse()` drops keys it does
// not declare, so a column added to the election schema later cannot reach
// this externally-consumed surface without being listed here. `email` is
// deliberately absent — it is candidate PII, kept out of the column allowlist
// and out of the default row, and this is the last line of that defence.
const candidacyFieldsSchema = z.object({
  id: z.string().nullish(),
  createdAt: z.date().nullish(),
  updatedAt: z.date().nullish(),
  brDatabaseId: z.number().nullish(),
  slug: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  party: z.string().nullish(),
  isIncumbent: z.boolean().nullish(),
  gpCandidateId: z.string().nullish(),
  placeName: z.string().nullish(),
  state: z.string().nullish(),
  image: z.string().nullish(),
  about: z.string().nullish(),
  urls: z.array(z.string()).nullish(),
  electionFrequency: z.array(z.number()).nullish(),
  salary: z.string().nullish(),
  normalizedPositionName: z.string().nullish(),
  positionName: z.string().nullish(),
  positionDescription: z.string().nullish(),
  raceId: z.string().nullish(),
  personId: z.string().nullish(),
})

const raceSchema = z.object({
  id: z.string().nullish(),
  createdAt: z.date().nullish(),
  updatedAt: z.date().nullish(),
  brHashId: z.string().nullish(),
  brDatabaseId: z.number().nullish(),
  electionDate: z.date().nullish(),
  slug: z.string().nullish(),
  state: z.string().nullish(),
  positionGeoid: z.string().nullish(),
  positionLevel: z.string().nullish(),
  normalizedPositionName: z.string().nullish(),
  positionNames: z.array(z.string()).nullish(),
  positionDescription: z.string().nullish(),
  filingOfficeAddress: z.string().nullish(),
  filingPhoneNumber: z.string().nullish(),
  paperworkInstructions: z.string().nullish(),
  filingRequirements: z.string().nullish(),
  isRunoff: z.boolean().nullish(),
  isPrimary: z.boolean().nullish(),
  partisanType: z.string().nullish(),
  filingDateStart: z.date().nullish(),
  filingDateEnd: z.date().nullish(),
  employmentType: z.string().nullish(),
  eligibilityRequirements: z.string().nullish(),
  salary: z.string().nullish(),
  subAreaName: z.string().nullish(),
  subAreaValue: z.string().nullish(),
  numberOfSeats: z.number().nullish(),
  winNumber: z.number().nullish(),
  isPartisan: z.boolean().nullish(),
  officeType: z.string().nullish(),
  officialOfficeName: z.string().nullish(),
  officeLevel: z.string().nullish(),
  frequency: z.array(z.number()).nullish(),
  electionCode: z.string().nullish(),
  projectedTurnout: z.number().nullish(),
  projectedTurnoutLower: z.number().nullish(),
  projectedTurnoutUpper: z.number().nullish(),
  inferenceAt: z.date().nullish(),
  placeId: z.string().nullish(),
  positionId: z.string().nullish(),
})

const issueSchema = z.object({
  id: z.string().nullish(),
  createdAt: z.date().nullish(),
  updatedAt: z.date().nullish(),
  brDatabaseId: z.number().nullish(),
  expandedText: z.string().nullish(),
  key: z.string().nullish(),
  name: z.string().nullish(),
  parentId: z.string().nullish(),
})

const stanceSchema = z.object({
  id: z.string().nullish(),
  createdAt: z.date().nullish(),
  updatedAt: z.date().nullish(),
  brDatabaseId: z.number().nullish(),
  stanceLocale: z.string().nullish(),
  stanceReferenceUrl: z.string().nullish(),
  stanceStatement: z.string().nullish(),
  issueId: z.string().nullish(),
  candidacyId: z.string().nullish(),
  Issue: issueSchema.nullish(),
})

const candidacySchema = candidacyFieldsSchema.extend({
  Stances: z.array(stanceSchema).nullish(),
  Race: raceSchema.nullish(),
})

export const candidaciesResponseSchema = z.array(candidacySchema)

@Controller('elections/candidacies')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ElectionCandidaciesController {
  constructor(private readonly candidaciesService: CandidaciesService) {}

  @UseGuards(M2MOnly)
  @Get()
  @ResponseSchema(candidaciesResponseSchema)
  async getCandidates(@Query() filterDto: CandidacyFilterDto) {
    return await this.candidaciesService.getCandidacies(filterDto)
  }
}
