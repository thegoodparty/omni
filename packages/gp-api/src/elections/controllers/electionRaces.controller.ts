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
import { RaceFilterDto } from '@/electionDb/races/races.schema'
import { RacesService } from '@/electionDb/races/races.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'

// Every field is nullish because `?raceColumns=`/`?placeColumns=`/
// `?candidacyColumns=` let the caller select an arbitrary subset, so any key
// may legitimately be absent. The schema earns its keep in the other
// direction: `.parse()` drops keys it does not declare, so a column added to
// the election schema later cannot reach this externally-consumed surface
// without being listed here. `Candidacy.email` is deliberately absent.
const placeSchema = z.object({
  id: z.string().nullish(),
  createdAt: z.date().nullish(),
  updatedAt: z.date().nullish(),
  brDatabaseId: z.number().nullish(),
  name: z.string().nullish(),
  slug: z.string().nullish(),
  geoId: z.string().nullish(),
  mtfcc: z.string().nullish(),
  state: z.string().nullish(),
  cityLargest: z.string().nullish(),
  countyName: z.string().nullish(),
  population: z.number().nullish(),
  density: z.number().nullish(),
  incomeHouseholdMedian: z.number().nullish(),
  unemploymentRate: z.number().nullish(),
  homeValue: z.number().nullish(),
  parentId: z.string().nullish(),
})

const candidacySchema = z.object({
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

const raceFieldsSchema = z.object({
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

const raceSchema = raceFieldsSchema.extend({
  Place: placeSchema.nullish(),
  Candidacies: z.array(candidacySchema).nullish(),
})

export const racesResponseSchema = z.array(raceSchema)

@Controller('elections/races')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ElectionRacesController {
  constructor(private readonly racesService: RacesService) {}

  @UseGuards(M2MOnly)
  @Get()
  @ResponseSchema(racesResponseSchema)
  async getRaces(@Query() filterDto: RaceFilterDto) {
    return this.racesService.findRaces(filterDto)
  }
}
