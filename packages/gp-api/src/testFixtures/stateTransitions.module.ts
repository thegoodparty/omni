import { ElectionsModule } from '@/elections/elections.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { Module } from '@nestjs/common'
import { StateTransitionsService } from './services/stateTransitions.service'

@Module({
  imports: [ElectionsModule, ElectedOfficeModule, OrganizationsModule],
  providers: [StateTransitionsService],
  exports: [StateTransitionsService],
})
export class StateTransitionsModule {}
