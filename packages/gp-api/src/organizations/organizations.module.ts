import { ElectionsModule } from '@/elections/elections.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { EmailModule } from '@/email/email.module'
import { FeaturesModule } from '@/features/features.module'
import { UsersModule } from '@/users/users.module'
import { CrmModule } from '@/crm/crmModule'
import { Module } from '@nestjs/common'
import { UseOrganizationGuard } from './guards/UseOrganization.guard'
import { OrganizationsController } from './organizations.controller'
import { TeamController } from './team.controller'
import { OrganizationMembershipService } from './services/organizationMembership.service'
import { OrganizationTeamService } from './services/organizationTeam.service'
import { OrganizationsService } from './services/organizations.service'

@Module({
  imports: [
    ElectionsModule,
    ClerkModule,
    EmailModule,
    FeaturesModule,
    UsersModule,
    CrmModule,
  ],
  providers: [
    OrganizationsService,
    OrganizationMembershipService,
    OrganizationTeamService,
    UseOrganizationGuard,
  ],
  controllers: [OrganizationsController, TeamController],
  exports: [
    OrganizationsService,
    OrganizationMembershipService,
    UseOrganizationGuard,
  ],
})
export class OrganizationsModule {}
