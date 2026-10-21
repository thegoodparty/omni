import { NoSuchKey, S3ServiceException } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { realClock, s3ObjectStore, sqsDispatchQueue } from './awsAdapters'

const s3 = (send: ReturnType<typeof vi.fn>) =>
  s3ObjectStore({ send } as unknown as Parameters<typeof s3ObjectStore>[0])

const noSuchKey = () => new NoSuchKey({ $metadata: {}, message: 'nope' })

// AccessDenied is what S3 returns for a MISSING key when the caller cannot
// list, so the two are indistinguishable by status alone — which is why the
// sweep's IAM policy grants ListBucket, and why this adapter must not paper
// over the difference.
const accessDenied = () =>
  new S3ServiceException({
    name: 'AccessDenied',
    $fault: 'client',
    $metadata: { httpStatusCode: 403 },
    message: 'Access Denied',
  })

describe('s3ObjectStore.getText', () => {
  it('resolves the body for a key that is there', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToString: async () => '{"ok":true}' },
    })
    expect(await s3(send).getText('b', 'k')).toBe('{"ok":true}')
  })

  // The contract the poll depends on: "not there yet" is the normal state
  // while a run is still going, not an error.
  it('resolves undefined for a key that is not there yet', async () => {
    const send = vi.fn().mockRejectedValue(noSuchKey())
    expect(await s3(send).getText('b', 'k')).toBeUndefined()
  })

  // THE ONE THAT MUST NOT BE SWALLOWED. Treating a denied read as "not there
  // yet" turns a misconfigured role into a poll that spins until it times
  // out — the same outage wearing a disguise, and far harder to diagnose than
  // a thrown AccessDenied on the first read.
  it('throws on AccessDenied rather than reporting it as absent', async () => {
    const send = vi.fn().mockRejectedValue(accessDenied())
    await expect(s3(send).getText('b', 'k')).rejects.toThrow(/Access Denied/)
  })

  it('throws any other failure too', async () => {
    const send = vi.fn().mockRejectedValue(new Error('connection reset'))
    await expect(s3(send).getText('b', 'k')).rejects.toThrow('connection reset')
  })

  // Two buckets, one store: the runner stages into the metadata bucket and
  // polls the artifacts bucket, so a bucket baked into the adapter would make
  // one of those reach the wrong place.
  it('sends the bucket it was given, per call', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToString: async () => 'x' },
    })
    const store = s3(send)
    await store.getText('metadata-dev', 'a')
    await store.getText('artifacts-dev', 'b')
    const buckets = send.mock.calls.map((c) => c[0].input.Bucket)
    expect(buckets).toEqual(['metadata-dev', 'artifacts-dev'])
  })
})

describe('s3ObjectStore.putText', () => {
  it('writes to the bucket and key it was given', async () => {
    const send = vi.fn().mockResolvedValue({})
    await s3(send).putText('metadata-dev', '_judge/a/b/manifest.json', '{}')
    const input = send.mock.calls[0]?.[0].input
    expect(input.Bucket).toBe('metadata-dev')
    expect(input.Key).toBe('_judge/a/b/manifest.json')
    expect(input.Body).toBe('{}')
  })
})

describe('sqsDispatchQueue', () => {
  it('sends the body with its FIFO group and dedup id', async () => {
    const send = vi.fn().mockResolvedValue({})
    const queue = sqsDispatchQueue(
      { send } as unknown as Parameters<typeof sqsDispatchQueue>[0],
      'https://sqs.test/agent-dispatch-dev.fifo',
    )
    await queue.send({
      body: '{"run_id":"_judge-x"}',
      groupId: 'g',
      deduplicationId: 'd',
    })
    const input = send.mock.calls[0]?.[0].input
    expect(input.QueueUrl).toBe('https://sqs.test/agent-dispatch-dev.fifo')
    expect(input.MessageBody).toBe('{"run_id":"_judge-x"}')
    // Dropping either turns a FIFO send into a 400, and dropping the dedup id
    // alone would let a retried dispatch run the agent twice.
    expect(input.MessageGroupId).toBe('g')
    expect(input.MessageDeduplicationId).toBe('d')
  })
})

describe('realClock', () => {
  it('actually waits', async () => {
    const before = Date.now()
    await realClock.sleep(25)
    expect(Date.now() - before).toBeGreaterThanOrEqual(20)
  })

  it('reports a real time', () => {
    expect(Math.abs(realClock.now().getTime() - Date.now())).toBeLessThan(1000)
  })
})
