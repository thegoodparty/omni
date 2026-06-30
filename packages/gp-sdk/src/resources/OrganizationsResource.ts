import type {
  AdminOrganization,
  ListOrganizationsOptions,
  OrganizationListItem,
  PatchOrganizationInput,
} from '../types/organization'
import { BaseResource } from './BaseResource'

export class OrganizationsResource extends BaseResource {
  protected readonly resourceBasePath = '/organizations'

  get = (slug: string): Promise<AdminOrganization> =>
    this.getRequest<AdminOrganization>(`${this.resourceBasePath}/admin/${slug}`)

  list = (
    options?: ListOrganizationsOptions,
  ): Promise<{ organizations: OrganizationListItem[] }> =>
    this.getRequest<{ organizations: OrganizationListItem[] }>(
      `${this.resourceBasePath}/admin/list`,
      options,
    )

  patch = (
    slug: string,
    input: PatchOrganizationInput,
  ): Promise<AdminOrganization> =>
    this.patchRequest<AdminOrganization>(
      `${this.resourceBasePath}/admin/${slug}`,
      input,
    )
}
