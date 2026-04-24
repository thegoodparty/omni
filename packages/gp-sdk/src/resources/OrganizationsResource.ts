import type {
  ListOrganizationsOptions,
  Organization,
  OrganizationListItem,
  PatchOrganizationInput,
} from '../types/organization'
import { BaseResource } from './BaseResource'

export class OrganizationsResource extends BaseResource {
  protected readonly resourceBasePath = '/organizations'

  get = (slug: string): Promise<Organization> =>
    this.getRequest<Organization>(`${this.resourceBasePath}/admin/${slug}`)

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
  ): Promise<Organization> =>
    this.patchRequest<Organization>(
      `${this.resourceBasePath}/admin/${slug}`,
      input,
    )
}
