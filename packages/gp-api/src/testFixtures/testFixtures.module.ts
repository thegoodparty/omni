import { ElectionsModule } from '@/elections/elections.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { Module } from '@nestjs/common'
import { TestFixturesController } from './testFixtures.controller'
import { TestFixturesService } from './services/testFixtures.service'

@Module({
  imports: [
    ClerkModule,
    ElectionsModule,
    ElectedOfficeModule,
    OrganizationsModule,
  ],
  controllers: [TestFixturesController],
  providers: [TestFixturesService],
})
export class TestFixturesModule {}
