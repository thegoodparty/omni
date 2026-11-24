import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ScaleToWinCampaignService } from './services/scaleToWinCampaign.service'
import { ScaleToWinContactsService } from './services/scaleToWinContacts.service'
import { ScaleToWinHttpService } from './services/scaleToWinHttp.service'

@Module({
  imports: [HttpModule],
  providers: [
    ScaleToWinHttpService,
    ScaleToWinCampaignService,
    ScaleToWinContactsService,
  ],
  exports: [ScaleToWinCampaignService, ScaleToWinContactsService],
})
export class ScaleToWinModule {}
