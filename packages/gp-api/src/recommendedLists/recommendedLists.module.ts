import { Module } from '@nestjs/common'
import { CampaignIdeologyModule } from '@/campaignIdeology/campaignIdeology.module'
import { CampaignStrategyModule } from '@/campaignStrategy/campaignStrategy.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { VotersModule } from '@/voters/voters.module'
import { RecommendedListsController } from './recommendedLists.controller'
import { RecommendedListsService } from './services/recommendedLists.service'

@Module({
  imports: [
    ContactsModule,
    CampaignIdeologyModule,
    // For ElectionApiService, the one client that already fetches
    // win-number data. A second election-api client here would be a second
    // place for the vote goal to be defined.
    CampaignStrategyModule,
    VotersModule,
    PeopleQueryModule,
  ],
  controllers: [RecommendedListsController],
  providers: [RecommendedListsService],
})
export class RecommendedListsModule {}
