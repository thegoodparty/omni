import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ShadowReadService } from '../shadowRead.service'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'

export interface DistrictById {
  id: string
  type: string
  name: string
  state: string
}

@Injectable()
export class DistrictService extends createPeopleDbBase(
  PEOPLE_MODELS.District,
) {
  @Inject(ShadowReadService)
  private readonly shadow!: ShadowReadService

  async findDistrictById(id: string): Promise<DistrictById> {
    if (!this.shadow.enabled) return this.findDistrictByIdFromPostgres(id)
    return this.shadow.compare({
      op: 'district-by-id',
      districtId: id,
      authoritative: async () => {
        const d = await this.shadow.databricks.resolveDistrict(id)
        return {
          id: d.districtId,
          type: d.districtType,
          name: d.districtName,
          state: d.state,
        }
      },
      comparison: () => this.findDistrictByIdFromPostgres(id),
      fingerprintAuthoritative: (d: DistrictById) =>
        `${d.state}/${d.type}/${d.name}`,
      fingerprintComparison: (d: DistrictById) =>
        `${d.state}/${d.type}/${d.name}`,
    })
  }

  private async findDistrictByIdFromPostgres(
    id: string,
  ): Promise<DistrictById> {
    const district = await this.model.findUnique({
      where: { id },
      select: { id: true, type: true, name: true, state: true },
    })
    if (!district) {
      throw new NotFoundException(`District not found for id=${id}`)
    }
    const { id: districtId, type, name, state } = district
    return {
      id: districtId,
      type,
      name,
      state,
    }
  }
}
