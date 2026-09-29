import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import {
  GetPersonByIdParamsDTO,
  GetPersonBySlugParamsDTO,
  PersonFilterDto,
} from '@/electionDb/persons/persons.schema'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { PositionLevel } from '@/generated/election-prisma'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'

const positionLevelSchema = z.enum(PositionLevel)

// Every field is optional because `?columns=` returns a partial row. The
// schemas are here to STRIP, not to require: `email`, `phone` and
// `gpApiUserId` are absent on purpose, so a Prisma `omit` that ever regresses
// still cannot put them on the wire.
const personScalarsSchema = z.object({
  id: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  brPersonId: z.number().nullable().optional(),
  slug: z.string().optional(),
  firstName: z.string().nullable().optional(),
  middleName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  nickname: z.string().nullable().optional(),
  suffix: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  bioText: z.string().nullable().optional(),
  headshotUrl: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  facebookUrl: z.string().nullable().optional(),
  twitterUrl: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  degrees: z.json().optional(),
  experiences: z.json().optional(),
  state: z.string().nullable().optional(),
  isPledged: z.boolean().optional(),
})

const officeHolderSchema = z.object({
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
  // Derived by PersonsService.attachOfficeContext on the spine reads only, so
  // absent on the list route's raw OfficeHolders.
  positionSlug: z.string().nullable().optional(),
  positionLevel: positionLevelSchema.nullable().optional(),
})

const candidacySchema = z.object({
  id: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  brDatabaseId: z.number().optional(),
  slug: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  websiteUrl: z.string().nullable().optional(),
  party: z.string().nullable().optional(),
  isIncumbent: z.boolean().nullable().optional(),
  gpCandidateId: z.string().nullable().optional(),
  placeName: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  about: z.string().nullable().optional(),
  urls: z.array(z.string()).optional(),
  electionFrequency: z.array(z.number()).optional(),
  salary: z.string().nullable().optional(),
  normalizedPositionName: z.string().nullable().optional(),
  positionName: z.string().nullable().optional(),
  positionDescription: z.string().nullable().optional(),
  raceId: z.string().nullable().optional(),
  personId: z.string().nullable().optional(),
  Race: z
    .object({
      electionDate: z.date(),
      slug: z.string(),
      positionLevel: positionLevelSchema,
    })
    .nullable()
    .optional(),
})

export const personListResponseSchema = z.array(
  personScalarsSchema.extend({
    OfficeHolders: z.array(officeHolderSchema).optional(),
    Candidacies: z.array(candidacySchema).optional(),
  }),
)

export const personSpineResponseSchema = personScalarsSchema.extend({
  OfficeHolders: z.array(officeHolderSchema),
  Candidacies: z.array(candidacySchema),
})

@Controller('elections/persons')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ElectionPersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @UseGuards(M2MOnly)
  @Get()
  @ResponseSchema(personListResponseSchema)
  async getPersons(@Query() filterDto: PersonFilterDto) {
    return this.personsService.getPersons(filterDto)
  }

  // Declared before :personId so the literal segment isn't captured as an id.
  @UseGuards(M2MOnly)
  @Get('by-slug/:slug')
  @ResponseSchema(personSpineResponseSchema)
  async getPersonBySlug(@Param() params: GetPersonBySlugParamsDTO) {
    return this.personsService.getPersonBySlug(params.slug)
  }

  @UseGuards(M2MOnly)
  @Get(':personId')
  @ResponseSchema(personSpineResponseSchema)
  async getPersonById(@Param() params: GetPersonByIdParamsDTO) {
    return this.personsService.getPersonById(params.personId)
  }
}
