import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ROBOCALL_VENDOR } from '@/outreach/vendor/robocallVendor'
import { CallfireRobocallVendor } from './callfireRobocallVendor'
import { CallfireBroadcastService } from './services/callfireBroadcast.service'
import { CallfireContactsService } from './services/callfireContacts.service'
import { CallfireDncService } from './services/callfireDnc.service'
import { CallfireErrorHandlingService } from './services/callfireErrorHandling.service'
import { CallfireHttpService } from './services/callfireHttp.service'
import { CallfireMediaService } from './services/callfireMedia.service'
import { CallfireNumbersService } from './services/callfireNumbers.service'
import { CallfireResultsService } from './services/callfireResults.service'

// Vendor wrapper for CallFire (robocall / voice broadcast): the HTTP/auth
// foundation, the API-surface services a send needs, and the adapter that binds
// them to the vendor-neutral RobocallVendor port. Exporting the ROBOCALL_VENDOR
// binding lets the send chain depend on the port, so switching vendors is a DI
// change (importing this module) rather than a rewrite.
@Module({
  imports: [HttpModule],
  providers: [
    CallfireErrorHandlingService,
    CallfireHttpService,
    CallfireNumbersService,
    CallfireMediaService,
    CallfireContactsService,
    CallfireBroadcastService,
    CallfireResultsService,
    CallfireDncService,
    { provide: ROBOCALL_VENDOR, useClass: CallfireRobocallVendor },
  ],
  exports: [ROBOCALL_VENDOR],
})
export class CallfireModule {}
