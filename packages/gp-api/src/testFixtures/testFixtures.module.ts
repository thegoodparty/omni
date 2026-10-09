import { OrganizationsModule } from '@/organizations/organizations.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { Module } from '@nestjs/common'
import { TestFixturesController } from './testFixtures.controller'
import { TestFixturesService } from './services/testFixtures.service'
import { StateTransitionsModule } from './stateTransitions.module'

@Module({
  imports: [ClerkModule, OrganizationsModule, StateTransitionsModule],
  controllers: [TestFixturesController],
  providers: [TestFixturesService],
})
export class TestFixturesModule {}
