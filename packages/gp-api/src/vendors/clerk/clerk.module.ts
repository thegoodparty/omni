import { Module } from '@nestjs/common'
import { AUTH_PROVIDER_TOKEN } from '@/authentication/interfaces/auth-provider.interface'
import {
  CLERK_CLIENT_PROVIDER_TOKEN,
  ClerkClientProvider,
} from '@/vendors/clerk/providers/clerk-client.provider'
import { ClerkAuthService } from '@/vendors/clerk/services/clerk-auth.service'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { ClerkInvitationsService } from '@/vendors/clerk/services/clerkInvitations.service'

@Module({
  providers: [
    ClerkClientProvider,
    {
      provide: AUTH_PROVIDER_TOKEN,
      useClass: ClerkAuthService,
    },
    ElectionApiTokenService,
    ClerkInvitationsService,
  ],
  exports: [
    AUTH_PROVIDER_TOKEN,
    CLERK_CLIENT_PROVIDER_TOKEN,
    ElectionApiTokenService,
    ClerkInvitationsService,
  ],
})
export class ClerkModule {}
