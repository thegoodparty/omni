import { useOrganization } from '@shared/organization-picker'

// gp-api resolves an org's district as `overrideDistrict ?? position?.district`
// (OrganizationsService.makeFriendly) — the same precedence
// ContactsService.resolveDistrictInfoFromOrg uses to decide whether to 400 — and
// GET /v1/organizations returns it on every org. So a null district predicts that
// 400 on any surface without spending the request.
//
// This lives outside ContactsTableProvider because that provider is mounted only
// on the contacts route, while polls (Serve), door knocking, campaign manager and
// onboarding all read district-dependent data too.
export const useDistrictResolution = () => {
  const organization = useOrganization()

  return {
    isUnresolvable: organization ? organization.district === null : false,
    officeName: organization?.positionName ?? null,
    organizationSlug: organization?.slug,
  }
}
