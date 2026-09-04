import { Module } from '@nestjs/common'
import { CampaignIdeologyModule } from '@/campaignIdeology/campaignIdeology.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { VotersModule } from '@/voters/voters.module'
import { RecommendedListsController } from './recommendedLists.controller'
import { RecommendedListsService } from './services/recommendedLists.service'

@Module({
  imports: [
    ContactsModule,
    CampaignIdeologyModule,
    VotersModule,
    PeopleQueryModule,
  ],
  controllers: [RecommendedListsController],
  providers: [RecommendedListsService],
})
export class RecommendedListsModule {}
