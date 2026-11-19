import { vi } from 'vitest'
import { CaseScoutBucketService } from '../services/caseScoutBucket.service'

// An in-memory S3 behind CaseScoutBucketService's three calls, with S3's
// create-only-if-missing semantics, so the jobs run against the real bucket
// logic without AWS. Objects are keyed `${bucket}/${key}`.
export const fakeS3 = (service: CaseScoutBucketService) => {
  const objects = new Map<string, string>()
  vi.spyOn(service, 'getText').mockImplementation(async (bucket, key) =>
    objects.get(`${bucket}/${key}`),
  )
  vi.spyOn(service, 'putText').mockImplementation(
    async (bucket, key, body, options) => {
      const id = `${bucket}/${key}`
      if (options?.ifAbsent && objects.has(id)) return false
      objects.set(id, body)
      return true
    },
  )
  vi.spyOn(service, 'listKeys').mockImplementation(async (bucket, prefix) =>
    [...objects.keys()]
      .filter((id) => id.startsWith(`${bucket}/${prefix}`))
      .map((id) => id.slice(bucket.length + 1))
      .sort(),
  )
  return objects
}
