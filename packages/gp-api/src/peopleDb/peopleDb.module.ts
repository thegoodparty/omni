import { Global, Module } from '@nestjs/common'
import { PeopleDbService } from './peopleDb.service'
import { PeopleDbUrlProvider } from './peopleDbUrl.provider'

@Global()
@Module({
  providers: [PeopleDbUrlProvider, PeopleDbService],
  exports: [PeopleDbUrlProvider, PeopleDbService],
})
export class PeopleDbModule {}
