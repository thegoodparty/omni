import { SetMetadata } from '@nestjs/common'

export const OWNER_ONLY_KEY = 'ownerOnlyDecorator'

/** Tells OrganizationRoleGuard to admit only the organization owner. */
export const OwnerOnly = () => SetMetadata(OWNER_ONLY_KEY, true)
