import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import type { Removal } from '../schemas/caseScoutBucket.schema'
import {
  proposeRemovalForCase,
  type SweepAttempt,
} from '../util/noisyCases.util'
import { CaseScoutBucketService } from './caseScoutBucket.service'
import type { CaseListInfo } from './caseScoutCaseLists.service'

// recordKey in src/chats/evals/judge/records.ts. A caseId may hold hyphens,
// so the attempt number is split off the end.
const RECORD_KEY =
  /^_judge\/(?<sweepId>[^/]+)\/records\/(?<arm>[^/]+)\/(?<agentId>[^/]+)\/(?<caseId>.+)-(?<attempt>\d+)\.json$/
const BASE_ARM = 'base'

// "Handled" is the record's own status (produced, blocked, infraError), not a
// judge verdict: verdicts live under rulings/, which the scout never reads.
const RunRecordStatusSchema = z.object({
  status: z.string(),
  startedAt: z.string(),
})

// Reads main's arm of the judge's sweep records to find noisy cases.
@Injectable()
export class CaseScoutJudgeRecordsService {
  constructor(private readonly bucket: CaseScoutBucketService) {}

  async proposeRemovals(
    judgeBucket: string,
    caseLists: CaseListInfo[],
  ): Promise<Removal[]> {
    const wanted = new Set(
      caseLists.flatMap((list) =>
        [...list.caseIds].map((caseId) => `${list.agentId}/${caseId}`),
      ),
    )
    const keysByCase = new Map<
      string,
      Array<{ key: string; sweepId: string }>
    >()
    for (const key of await this.bucket.listKeys(judgeBucket, '_judge/')) {
      const groups = RECORD_KEY.exec(key)?.groups
      const sweepId = groups?.sweepId
      if (!groups || !sweepId || groups.arm !== BASE_ARM) continue
      const id = `${groups.agentId}/${groups.caseId}`
      if (!wanted.has(id)) continue
      keysByCase.set(id, [...(keysByCase.get(id) ?? []), { key, sweepId }])
    }

    const removals: Removal[] = []
    for (const list of caseLists) {
      for (const caseId of [...list.caseIds].sort()) {
        const keys = keysByCase.get(`${list.agentId}/${caseId}`) ?? []
        const attempts = (
          await Promise.all(
            keys.map(async ({ key, sweepId }) => {
              const text = await this.bucket.getText(judgeBucket, key)
              // A record too malformed to read is neither handled nor not.
              const parsed = RunRecordStatusSchema.safeParse(
                text === undefined ? undefined : JSON.parse(text),
              )
              return parsed.success
                ? [{ sweepId, ...parsed.data } satisfies SweepAttempt]
                : []
            }),
          )
        ).flat()
        const removal = proposeRemovalForCase(list.agentId, caseId, attempts)
        if (removal) removals.push(removal)
      }
    }
    return removals
  }
}
