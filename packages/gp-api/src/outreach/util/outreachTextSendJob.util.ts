import type { JobData } from '@/jobs/jobs.registry'
import type { JobSendManyItem } from '@/jobs/jobs.service'

// Every producer of an outreachTextSend job sends it through sendMany with
// this item. The key makes a second send of one (outreach, sendSeq) a no-op
// while the first job is still queued or running, the way the SQS
// deduplication id did. The group makes two jobs for one outreach run one at
// a time, which the delivery layer's claim revert relies on.
export const outreachTextSendJob = (
  data: JobData<'outreachTextSend'>,
): JobSendManyItem<JobData<'outreachTextSend'>> => ({
  data,
  key: `${data.outreachId}:${data.sendSeq}`,
  group: String(data.outreachId),
})
