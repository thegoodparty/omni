import { Module } from '@nestjs/common'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ContactUploadFilesService } from './services/contactUploadFiles.service'

@Module({
  imports: [AwsModule],
  providers: [ContactUploadFilesService],
  exports: [ContactUploadFilesService],
})
export class ContactUploadFilesModule {}
