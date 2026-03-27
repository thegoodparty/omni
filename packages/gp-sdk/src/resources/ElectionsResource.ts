import type {
  DistrictTypeItem,
  DistrictNameItem,
  ListDistrictTypesOptions,
  ListDistrictNamesOptions,
} from '../types/district'
import { BaseResource } from './BaseResource'

export class ElectionsResource extends BaseResource {
  protected readonly resourceBasePath = '/elections'

  listDistrictTypes = (
    options: ListDistrictTypesOptions,
  ): Promise<DistrictTypeItem[]> =>
    this.getRequest<DistrictTypeItem[]>(
      `${this.resourceBasePath}/districts/types`,
      options,
    )

  listDistrictNames = (
    options: ListDistrictNamesOptions,
  ): Promise<DistrictNameItem[]> =>
    this.getRequest<DistrictNameItem[]>(
      `${this.resourceBasePath}/districts/names`,
      options,
    )
}
