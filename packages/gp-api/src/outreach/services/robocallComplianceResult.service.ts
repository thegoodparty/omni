import { Injectable } from '@nestjs/common'
import { RobocallComplianceVerdict } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { RobocallComplianceResult } from '../../generated/prisma'

// Persists and reads the server-side compliance verdict, keyed by audioKey. The
// check itself (transcribe + LLM) lives in RobocallComplianceService and is not
// touched here — this only records its verdict and answers the create gate.
@Injectable()
export class RobocallComplianceResultService extends createPrismaBase(
  MODELS.RobocallComplianceResult,
) {
  // Upsert by audioKey so a re-check overwrites the prior verdict rather than
  // accumulating rows: the recording is the same object, so its latest verdict
  // is the only one that should gate a create.
  async recordVerdict(
    audioKey: string,
    verdict: RobocallComplianceVerdict,
  ): Promise<RobocallComplianceResult> {
    const checkedAt = new Date()
    return this.model.upsert({
      where: { audioKey },
      create: { audioKey, passed: verdict.passed, checkedAt },
      update: { passed: verdict.passed, checkedAt },
    })
  }

  // The passing row for an audio key, or null — the create gate's single source
  // of truth that a recording cleared compliance before it can be billed.
  findPassing(audioKey: string): Promise<RobocallComplianceResult | null> {
    return this.findFirst({ where: { audioKey, passed: true } })
  }
}
