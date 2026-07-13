import { Controller, Get, Param, Query } from '@nestjs/common'
import { PersonsService } from './persons.service'
import { GetPersonByIdParamsDTO, PersonFilterDto } from './persons.schema'

@Controller('persons')
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @Get()
  async getPersons(@Query() filterDto: PersonFilterDto) {
    return this.personsService.getPersons(filterDto)
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
