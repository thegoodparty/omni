import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Marks a controller or handler as reachable without a Clerk M2M token.
 * The global `M2MAuthGuard` skips auth for anything annotated with this.
 * Used for the ALB health check, which cannot present a bearer token.
 */
export const PublicAccess = () => SetMetadata(IS_PUBLIC_KEY, true)
