import { SetMetadata } from '@nestjs/common'

export const ALLOW_VOLUNTEER_KEY = 'allowVolunteerDecorator'

/**
 * Tells OrganizationRoleGuard to admit any organization member, including
 * a volunteer. Without it, OrganizationRoleGuard defaults to
 * manager-or-above (owner | campaignAdmin) and 403s volunteer members.
 * Apply to any route that should be accessible to volunteers.
 */
export const AllowVolunteer = () => SetMetadata(ALLOW_VOLUNTEER_KEY, true)
