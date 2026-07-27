import { Module } from '@nestjs/common'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { PrismaModule } from './prisma/prisma.module'
import { PeopleModule } from './people/people.module'
import { DoorKnockingModule } from './doorKnocking/doorKnocking.module'
import { loggerModule } from './observability/logging/logger-module'

@Module({
  imports: [
    loggerModule,
    PrismaModule,
    HealthModule,
    PeopleModule,
    DoorKnockingModule,
    AuthModule,
  ],
})
export class AppModule {}
