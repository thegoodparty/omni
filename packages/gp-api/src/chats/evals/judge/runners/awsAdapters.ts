import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { MimeTypes } from 'http-constants-ts'
import type { Clock, DispatchQueue, ObjectStore } from './background'

// The three ports `runBackgroundCase` needs, against real AWS.
//
// Separate from `records.ts`'s S3 port, which looks similar and is not: that
// one is bound to a single bucket and raises on a missing key, because a
// record the sweep wrote and cannot read back is a fault. This one spans two
// buckets and must RESOLVE a missing key, because "not there yet" is the
// normal state of an artifact while the run that produces it is still going.
// Merging them would mean one of the two callers getting the wrong behaviour
// on the case that matters most.

// A MISSING KEY IS `undefined`, AND A DENIED ONE IS NOT.
//
// S3 hides key existence from a principal that cannot list: without
// s3:ListBucket, GetObject on a key that does not exist returns 403
// AccessDenied rather than 404 NoSuchKey. The sweep's IAM policy grants
// ListBucket on both buckets for exactly that reason — see
// modules/universal-judge-sweep-policy. If that grant is ever lost, this
// function starts throwing on every poll of a run still in flight, and the
// capture dies seconds after dispatch having already paid for it.
//
// So AccessDenied is deliberately NOT swallowed here. Treating it as "not
// there yet" would turn a misconfigured role into a poll that spins until it
// times out, which is the same outage wearing a disguise.
export const s3ObjectStore = (client: S3Client): ObjectStore => ({
  getText: async (bucket, key) => {
    try {
      const output = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )
      return await output.Body?.transformToString('utf8')
    } catch (err) {
      if (err instanceof NoSuchKey) return undefined
      throw err
    }
  },

  putText: async (bucket, key, body) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: MimeTypes.APPLICATION_JSON,
      }),
    )
  },
})

// The queue URL belongs to the adapter rather than to the runner, which is
// what `DispatchQueue`'s own comment asks for.
export const sqsDispatchQueue = (
  client: SQSClient,
  queueUrl: string,
): DispatchQueue => ({
  send: async ({ body, groupId, deduplicationId }) => {
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        MessageGroupId: groupId,
        MessageDeduplicationId: deduplicationId,
      }),
    )
  },
})

// Injected everywhere else so the poll loop runs in microseconds; this is the
// one implementation that actually waits.
export const realClock: Clock = {
  now: () => new Date(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
}
