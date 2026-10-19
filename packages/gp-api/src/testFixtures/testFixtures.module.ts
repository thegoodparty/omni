import { ElectionsModule } from '@/elections/elections.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { VendorMocksModule } from '@/vendorMocks/vendorMocks.module'
import { Module } from '@nestjs/common'
import { ActivitySeedModule } from './activitySeed.module'
import { TestFixturesController } from './testFixtures.controller'
import { TestFixturesVendorMocksController } from './testFixturesVendorMocks.controller'
import { TestFixturesService } from './services/testFixtures.service'
import { StateTransitionsModule } from './stateTransitions.module'

@Module({
  imports: [
    ActivitySeedModule,
    ClerkModule,
    ElectionsModule,
    OrganizationsModule,
    StateTransitionsModule,
    VendorMocksModule,
  ],
  controllers: [TestFixturesController, TestFixturesVendorMocksController],
  providers: [TestFixturesService],
})
export class TestFixturesModule {}
