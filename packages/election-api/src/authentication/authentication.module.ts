import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ClerkClientProvider } from './providers/clerk-client.provider'
import { M2MAuthGuard } from './guards/M2MAuth.guard'

/**
 * Registers the Clerk client and the global default-deny M2M guard.
 * Importing this module in AppModule protects every route by default;
 * routes opt out with `@PublicAccess()`.
 */
@Module({
  providers: [
    ClerkClientProvider,
    {
      provide: APP_GUARD,
      useClass: M2MAuthGuard,
    },
  ],
})
export class AuthenticationModule {}
