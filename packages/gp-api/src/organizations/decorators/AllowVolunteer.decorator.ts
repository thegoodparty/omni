import { SetMetadata } from '@nestjs/common'

export const ALLOW_VOLUNTEER_KEY = 'allowVolunteerDecorator'

/**
 * Tells OrganizationRoleGuard to admit any organization member, including a
 * volunteer. No live traffic reaches this branch today: every guard behind
 * `X-Organization-Slug` (UseOrganization, UseCampaign, ...) still fails
 * closed on a volunteer membership before OrganizationRoleGuard ever runs.
 * Phase 1.5 opens specific surfaces by loosening those guards deliberately,
 * route by route — this decorator ships now so that work is small.
 */
export const AllowVolunteer = () => SetMetadata(ALLOW_VOLUNTEER_KEY, true)
