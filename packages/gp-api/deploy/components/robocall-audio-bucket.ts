import * as aws from '@pulumi/aws'

export interface RobocallAudioBucketConfig {
  environment: 'dev' | 'prod'
}

/**
 * Private bucket for the recorded/uploaded robocall message a candidate sends
 * (voter-outreach-v2 robocall). The browser uploads the audio directly via a
 * presigned POST from `POST /v1/outreach/robocall/audio/presign`; gp-api reads
 * it back server-side to hand off to the delivery vendor. All public access is
 * blocked — the presigned POST is the only way in.
 *
 * Objects expire after 90 days: the raw recording is only needed through the
 * send and a short window after, and it is voice PII we don't want to keep
 * indefinitely. CORS is required for the browser's cross-origin POST.
 */
export function createRobocallAudioBucket({
  environment,
}: RobocallAudioBucketConfig): {
  bucket: aws.s3.Bucket
} {
  const select = <T>(values: Record<'dev' | 'prod', T>): T =>
    values[environment]

  const bucketName = `robocall-audio-${environment}`

  const bucket = new aws.s3.Bucket('robocall-audio-bucket', {
    bucket: bucketName,
    forceDestroy: false,
  })

  new aws.s3.BucketPublicAccessBlock('robocall-audio-pab', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  new aws.s3.BucketServerSideEncryptionConfigurationV2('robocall-audio-sse', {
    bucket: bucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: 'AES256',
        },
      },
    ],
  })

  new aws.s3.BucketLifecycleConfigurationV2('robocall-audio-lifecycle', {
    bucket: bucket.id,
    rules: [
      {
        id: 'expire-audio',
        status: 'Enabled',
        filter: {},
        expiration: {
          days: 90,
        },
      },
    ],
  })

  // Allow the browser to upload directly via presigned POST (a multipart form
  // POST, not PUT — the POST policy is what lets S3 enforce the size cap).
  new aws.s3.BucketCorsConfigurationV2('robocall-audio-cors', {
    bucket: bucket.id,
    corsRules: [
      {
        allowedHeaders: ['*'],
        allowedMethods: ['POST'],
        allowedOrigins: select({
          dev: ['http://localhost:4000', 'https://dev.goodparty.org'],
          prod: ['https://goodparty.org'],
        }),
        exposeHeaders: ['ETag'],
        maxAgeSeconds: 3600,
      },
    ],
  })

  return { bucket }
}
