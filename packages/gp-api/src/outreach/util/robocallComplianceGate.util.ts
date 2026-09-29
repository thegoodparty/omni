import { BadRequestException } from '@nestjs/common'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { RobocallComplianceResultService } from '../services/robocallComplianceResult.service'

export interface BoundComplianceVerdict {
  checkedAt: Date
  audioEtag: string
}

interface ComplianceGateDeps {
  s3: S3Service
  complianceResults: RobocallComplianceResultService
  audioBucket: string
}

// COMPLIANCE GATE (money/legal): a robocall row can only be created for audio
// that passed the server-side compliance check. The client UI runs the check
// first, but a crafted request must not skip it, so require a persisted PASSING
// verdict for this audioKey. The returned timestamp is mirrored onto the
// satellite so the dial step has a durable per-draft fact.
//
// ETAG BIND (legal): the passing verdict is bound to the exact bytes it
// checked. A presigned POST can overwrite the key with different bytes inside
// its expiry window, so re-read the object's current ETag and refuse a
// mismatch — a re-upload after the pass can't ride the old verdict. A verdict
// with no bound ETag (capture failed at check time) is not trusted: force a
// re-check. The matched ETag is FROZEN onto the row by the caller so the dial
// path re-verifies against what was approved here, not the mutable verdict.
export const requireBoundPassingCompliance = async (
  audioKey: string,
  { s3, complianceResults, audioBucket }: ComplianceGateDeps,
): Promise<BoundComplianceVerdict> => {
  const compliance = await complianceResults.findPassing(audioKey)
  if (!compliance) {
    throw new BadRequestException('Robocall audio has not passed compliance')
  }
  if (!compliance.audioEtag) {
    throw new BadRequestException(
      'Robocall audio compliance is stale; re-run the compliance check',
    )
  }
  const head = await s3.headObject(audioBucket, audioKey)
  if (!head || head.etag !== compliance.audioEtag) {
    throw new BadRequestException(
      'Robocall audio changed since compliance; re-run the compliance check',
    )
  }
  return { checkedAt: compliance.checkedAt, audioEtag: compliance.audioEtag }
}
