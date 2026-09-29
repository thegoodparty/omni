import { Global, Module } from '@nestjs/common'
import { ElectionDbService } from './electionDb.service'

@Global()
@Module({
  providers: [ElectionDbService],
  exports: [ElectionDbService],
})
export class ElectionDbModule {}
