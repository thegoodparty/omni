import { Module } from '@nestjs/common'
import { AwsModule } from 'src/vendors/aws/aws.module'
import { LlmModule } from '@/llm/llm.module'
import { AreaCodeFromZipService } from './util/areaCodeFromZip.util'

@Module({
  imports: [AwsModule, LlmModule],
  providers: [AreaCodeFromZipService],
  exports: [AreaCodeFromZipService],
})
export class AiModule {}
