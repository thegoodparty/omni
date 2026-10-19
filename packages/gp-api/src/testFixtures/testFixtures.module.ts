import { ElectionsModule } from '@/elections/elections.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { VendorMocksModule } from '@/vendorMocks/vendorMocks.module'
import { Module } from '@nestjs/common'
import { ActivitySeedModule } from './activitySeed.module'
import { TestFixturesController } from './testFixtures.controller'
import { TestFixturesJudgeController } from './testFixturesJudge.controller'
import { TestFixturesVendorMocksController } from './testFixturesVendorMocks.controller'
import { JudgeChatFixtureService } from './services/judgeChatFixture.service'
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
  controllers: [
    TestFixturesController,
    TestFixturesJudgeController,
    TestFixturesVendorMocksController,
  ],
  providers: [JudgeChatFixtureService, TestFixturesService],
})
export class TestFixturesModule {}
