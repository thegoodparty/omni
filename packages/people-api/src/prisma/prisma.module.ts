import { Module, Global } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { DatabaseUrlProvider } from './database-url.provider'

@Global()
@Module({
  providers: [DatabaseUrlProvider, PrismaService],
  exports: [DatabaseUrlProvider, PrismaService],
})
export class PrismaModule {}
