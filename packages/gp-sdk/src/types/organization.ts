export type OrgDistrict = {
  id: string
  l2Type: string
  l2Name: string
}

export type OrgPosition = {
  id: string
  state: string
  brPositionId: string
}

export type Organization = {
  slug: string
  name: string | null
  positionName: string | null
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

export type OrganizationListItem = Organization & {
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
