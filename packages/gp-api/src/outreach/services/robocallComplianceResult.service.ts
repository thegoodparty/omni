import { Injectable } from '@nestjs/common'
import { RobocallComplianceVerdict } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { RobocallComplianceResult } from '../../generated/prisma'

// Persists and reads the server-side compliance verdict, keyed by audioKey. The
// check itself (transcribe + LLM) lives in RobocallComplianceService and is not
// touched here — this only records its verdict and answers the create gate.
@Injectable()
export class RobocallComplianceResultService extends createPrismaBase(
  MODELS.RobocallComplianceResult,
) {
  private readonly bucket: string

  constructor(private readonly s3: S3Service) {
    super()
    const bucket = process.env.ROBOCALL_AUDIO_BUCKET
    if (!bucket) throw new Error('ROBOCALL_AUDIO_BUCKET is not configured')
    this.bucket = bucket
  }

  // Upsert by audioKey so a re-check overwrites the prior verdict rather than
  // accumulating rows: the recording is the same object, so its latest verdict
  // is the only one that should gate a create. Captures the audio's S3 ETag now
  // (right after the check read the same bytes) and stores it, binding the
  // verdict to the exact recording — the create gate re-reads the current ETag
  // and refuses a mismatch, so bytes swapped after the pass can't slip through.
  async recordVerdict(
    audioKey: string,
    verdict: RobocallComplianceVerdict,
  ): Promise<RobocallComplianceResult> {
    const checkedAt = new Date()
    const head = await this.s3.headObject(this.bucket, audioKey)
    const audioEtag = head?.etag ?? null
    return this.model.upsert({
      where: { audioKey },
      create: { audioKey, passed: verdict.passed, checkedAt, audioEtag },
      update: { passed: verdict.passed, checkedAt, audioEtag },
    })
  }

  // The passing row for an audio key, or null — the create gate's single source
  // of truth that a recording cleared compliance before it can be billed.
  findPassing(audioKey: string): Promise<RobocallComplianceResult | null> {
    return this.findFirst({ where: { audioKey, passed: true } })
  }
}
