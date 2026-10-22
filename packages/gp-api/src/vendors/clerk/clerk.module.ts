import { Module } from '@nestjs/common'
import { AUTH_PROVIDER_TOKEN } from '@/authentication/interfaces/auth-provider.interface'
import {
  CLERK_CLIENT_PROVIDER_TOKEN,
  ClerkClientProvider,
} from '@/vendors/clerk/providers/clerk-client.provider'
import { ClerkAuthService } from '@/vendors/clerk/services/clerk-auth.service'
import { ClerkInvitationsService } from '@/vendors/clerk/services/clerkInvitations.service'

@Module({
  providers: [
    ClerkClientProvider,
    {
      provide: AUTH_PROVIDER_TOKEN,
      useClass: ClerkAuthService,
    },
    ClerkInvitationsService,
  ],
  exports: [
    AUTH_PROVIDER_TOKEN,
    CLERK_CLIENT_PROVIDER_TOKEN,
    ClerkInvitationsService,
  ],
})
export class ClerkModule {}
