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
import {
  MostElectionsDto,
  PlaceFilterDto,
} from '@/electionDb/places/places.schema'
import { PlacesService } from '@/electionDb/places/places.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'

const MIN_RACES = 100

// Every field is nullish because `?placeColumns=`/`?raceColumns=` let the
// caller select an arbitrary subset, so any key may legitimately be absent.
// The schema earns its keep in the other direction: `.parse()` drops keys it
// does not declare, so a column added to the election schema later cannot
// reach this externally-consumed surface without being listed here.
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

const placeFieldsSchema = z.object({
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

const relatedPlaceSchema = placeFieldsSchema.extend({
  Races: z.array(raceSchema).nullish(),
})

const placeSchema = relatedPlaceSchema.extend({
  children: z.array(relatedPlaceSchema).nullish(),
  parent: relatedPlaceSchema.nullish(),
  counties: z.array(relatedPlaceSchema).nullish(),
  districts: z.array(relatedPlaceSchema).nullish(),
  others: z.array(relatedPlaceSchema).nullish(),
})

export const placesResponseSchema = z.array(placeSchema)

export const mostElectionsResponseSchema = z.array(
  z.object({
    slug: z.string(),
    name: z.string(),
    race_count: z.number(),
  }),
)

@Controller('elections/places')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ElectionPlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @UseGuards(M2MOnly)
  @Get()
  @ResponseSchema(placesResponseSchema)
  async getPlaces(@Query() filterDto: PlaceFilterDto) {
    return this.placesService.getPlaces(filterDto)
  }

  @UseGuards(M2MOnly)
  @Get('most-elections')
  @ResponseSchema(mostElectionsResponseSchema)
  async getPlacesWithMostElections(
    @Query() mostElectionsDto: MostElectionsDto,
  ) {
    return this.placesService.getPlacesWithMostElections(
      MIN_RACES,
      mostElectionsDto.count,
    )
  }
}
