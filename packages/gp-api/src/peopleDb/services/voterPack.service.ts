import { Injectable } from '@nestjs/common'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import { DatabricksVoterPackService } from '../databricks/databricksVoterPack.service'
import { VoterReadLogService } from '../databricks/voterReadLog.service'

@Injectable()
export class VoterPackService {
  constructor(
    private readonly databricksPack: DatabricksVoterPackService,
    private readonly readLog: VoterReadLogService,
  ) {}

  // The pack is a payload, not an artifact — built per request, never stored.
  // It reads CSV through external links rather than the inline path, because
  // accumulating a whole district's chunks before returning is the unbounded
  // materialization a district-sized read has to avoid.
  //
  // `signal` is the caller's response stream. A build with nobody left to read
  // it stops at the next chunk rather than reading the rest of the district
  // for a socket that is already closed.
  async build(
    request: DoorKnockingPackRequest,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return this.readLog.measure({
      op: 'dk-pack',
      districtId: request.districtId,
      read: () => this.databricksPack.build(request, signal),
    })
  }
}
