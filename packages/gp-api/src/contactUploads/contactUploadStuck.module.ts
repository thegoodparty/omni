import { Module } from '@nestjs/common'
import { ContactUploadStuckService } from './services/contactUploadStuck.service'

@Module({
  providers: [ContactUploadStuckService],
  exports: [ContactUploadStuckService],
})
export class ContactUploadStuckModule {}
