export type OrgDistrict = {
  id: string
  l2Type: string
  l2Name: string
}

export type OrgPosition = {
  id: string
  // Optional: older gp-api deployments omit it, current ones return it.
  name?: string | null
  state: string
  brPositionId: string
}

// Distinct from contracts' `Organization` (the DB-entity shape): this is the
// admin org-detail shape returned by gp-api's `/organizations/admin/:slug`.
// Named `AdminOrganization` so it never silently merges with the contracts type.
export type AdminOrganization = {
  slug: string
  name: string | null
  positionName: string | null
  // Optional: older gp-api deployments omit it, current ones return it.
  customPositionName?: string | null
  position: OrgPosition | null
  district: OrgDistrict | null
  electedOfficeId: string | null
  campaignId: number | null
}

export type ListOrganizationsOptions = {
  slug?: string
  email?: string
}

export type OrganizationOwnerSummary = {
  id: number
  email: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
}

export type OrganizationListItem = AdminOrganization & {
  extra: {
    positionName: string | null
    hasDistrictOverride: boolean
    owner: OrganizationOwnerSummary
    campaign: {
      id: number
      slug: string
      details: unknown
    } | null
  }
}

export type PatchOrganizationInput = {
  ballotReadyPositionId?: string | null
  overrideDistrictId?: string | null
  customPositionName?: string | null
}
