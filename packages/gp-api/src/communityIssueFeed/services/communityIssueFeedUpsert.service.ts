import { Injectable } from '@nestjs/common'
import { ExperimentRun } from '../../generated/prisma'
import { CommunityIssuesArtifact } from '../communityIssueFeedArtifact.validation'

@Injectable()
export class CommunityIssueFeedUpsertService {
  async upsertFromArtifact(
    _run: ExperimentRun,
    _artifact: CommunityIssuesArtifact,
  ): Promise<void> {
    throw new Error('not implemented')
  }
}
