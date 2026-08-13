import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import { FastifyRequest } from 'fastify'
import { PersonsService } from './persons.service'
import {
  GetPersonByIdParamsDTO,
  GetPersonBySlugParamsDTO,
  PersonFilterDto,
} from './persons.schema'

// M2MAuthGuard tags verified machine callers with `m2mToken`; it stays unset
// for unauthenticated (and observe-only passthrough) requests.
type MaybeAuthenticatedRequest = FastifyRequest & { m2mToken?: unknown }

@Controller('persons')
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @Get()
  async getPersons(
    @Query() filterDto: PersonFilterDto,
    @Req() req: MaybeAuthenticatedRequest,
  ) {
    // gpApiUserId ties a person back to an internal gp-api user, so filtering
    // on it is an enumeration oracle (result presence/absence plus default
    // fields like name/slug leak the association) on this public endpoint.
    // Keep it strictly service-to-service: require a verified M2M token here
    // regardless of the global ELECTION_API_AUTH_ENFORCED rollout flag.
    if (filterDto.gpApiUserId && !req.m2mToken) {
      throw new UnauthorizedException(
        'gpApiUserId filter requires M2M authentication',
      )
    }
    return this.personsService.getPersons(filterDto)
  }

  // Declared before :personId so the literal segment isn't captured as an id.
  @Get('by-slug/:slug')
  async getPersonBySlug(@Param() params: GetPersonBySlugParamsDTO) {
    return this.personsService.getPersonBySlug(params.slug)
  }

  // Resolves the person's L2 voter-join district (Position.districtId) for the
  // voter-density heat map. Static suffix keeps it distinct from `:personId`.
  @Get(':personId/voter-district')
  async getVoterDistrict(@Param() params: GetPersonByIdParamsDTO) {
    return this.personsService.getVoterDistrict(params.personId)
  }

  @Get(':personId')
  async getPersonById(@Param() params: GetPersonByIdParamsDTO) {
    return this.personsService.getPersonById(params.personId)
  }
}
