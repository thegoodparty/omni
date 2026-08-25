import { Injectable, NotFoundException } from '@nestjs/common'
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
  // Deliberately NOT dual-read. Every voter read resolves its district first,
  // including the ones still served only by Postgres (door knocking, voter
  // packs, CSV download). Routing this through Databricks would make those
  // reads fail when Databricks does, and would fold Databricks latency into
  // the Postgres side of every comparison. The Databricks arm resolves the
  // district itself, so its cost is already counted in that arm's timing.
  async findDistrictById(id: string): Promise<DistrictById> {
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
