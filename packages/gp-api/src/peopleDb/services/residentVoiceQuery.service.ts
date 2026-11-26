import { Injectable } from '@nestjs/common'
import { PeopleDbxStatementClient } from '../databricks/peopleDbxStatement.client'
import {
  buildResidentVoicesSql,
  mapResidentVoiceRows,
  RESIDENT_VOICES_ROW_LIMIT,
  type ResidentVoiceRow,
} from '../databricks/residentVoicesSql.util'

// Every comment the warehouse holds for a district, unpicked. It throws like
// any warehouse read; the caller decides what a failure means.
@Injectable()
export class ResidentVoiceQueryService {
  constructor(private readonly client: PeopleDbxStatementClient) {}

  async findForDistrict(
    districtId: string,
    signal: AbortSignal,
  ): Promise<ResidentVoiceRow[]> {
    const { rows } = await this.client.query(
      buildResidentVoicesSql(districtId),
      { signal, rowLimit: RESIDENT_VOICES_ROW_LIMIT },
    )
    return mapResidentVoiceRows(rows)
  }
}
