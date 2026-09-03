import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { CallfireErrorHandlingService } from './services/callfireErrorHandling.service'
import { CallfireHttpService } from './services/callfireHttp.service'

// Vendor wrapper for CallFire (contingency robocall / voice broadcast). This
// slice ships only the HTTP/auth foundation; the API-surface services
// (numbers / media / broadcast / etc.) land in the next workstream.
@Module({
  imports: [HttpModule],
  providers: [CallfireErrorHandlingService, CallfireHttpService],
  exports: [CallfireErrorHandlingService, CallfireHttpService],
})
export class CallfireModule {}
