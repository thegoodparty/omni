import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { ElectionsModule } from '@/elections/elections.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { StripeModule } from '@/vendors/stripe/stripe.module'
import { VendorMocksModule } from '@/vendorMocks/vendorMocks.module'
import { WebsitesModule } from '@/websites/websites.module'
import { Module } from '@nestjs/common'
import { ActivitySeedModule } from './activitySeed.module'
import { TestFixturesController } from './testFixtures.controller'
import { TestFixturesJudgeController } from './testFixturesJudge.controller'
import { TestFixturesStatesController } from './testFixturesStates.controller'
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
    OutreachModule,
    StateTransitionsModule,
    StripeModule,
    VendorMocksModule,
    WebsitesModule,
  ],
  controllers: [
    TestFixturesController,
    TestFixturesJudgeController,
    TestFixturesStatesController,
    TestFixturesVendorMocksController,
  ],
  providers: [
    DistrictResolverService,
    JudgeChatFixtureService,
    TestFixturesService,
  ],
})
export class TestFixturesModule {}
