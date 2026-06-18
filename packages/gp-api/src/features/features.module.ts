import { Global, Module } from '@nestjs/common'
import { FeaturesService } from './services/features.service'
import { FeaturesController } from './features.controller'
import { UsersModule } from 'src/users/users.module'

@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService],
  exports: [FeaturesService],
  imports: [UsersModule],
})
export class FeaturesModule {}
