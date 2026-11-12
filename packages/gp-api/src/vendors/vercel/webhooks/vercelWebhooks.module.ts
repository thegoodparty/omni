import { Module } from '@nestjs/common'
import { VercelWebhooksController } from './vercelWebhooks.controller'

@Module({
  controllers: [VercelWebhooksController],
})
export class VercelWebhooksModule {}
