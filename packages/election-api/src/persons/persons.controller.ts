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

  @Get(':personId')
  async getPersonById(@Param() params: GetPersonByIdParamsDTO) {
    return this.personsService.getPersonById(params.personId)
  }
}
