import * as aws from '@pulumi/aws'

export interface MeetingPipelineBucketConfig {
  environment: 'prod'
}

/**
 * Bucket for the meeting-pipeline data plane. Shared between:
 *  - the external `meeting_pipeline` lambdas/ECS tasks that write briefing
 *    JSON and intermediate artifacts under the `meeting_pipeline/` prefix
 *  - gp-api `TextToSpeechService`, which caches Polly audio under
 *    `speech/synth/` and hands the browser presigned GET URLs
 *  - issue capture's offline memos: the browser uploads a recording under
 *    `constituent-feedback/` by presigned POST, and batch Transcribe writes
 *    its transcript under `constituent-feedback-transcripts/`
 *
 * The dev bucket (`meeting-pipeline-dev`) was created out-of-band well
 * before this file existed; Pulumi does NOT own it. This component creates
 * the prod bucket so the existing select() in deploy/index.ts has
 * something real to point at in those environments. When the larger
 * meeting-pipeline Terraform stack eventually lands in gp-ai,
 * those buckets can be `terraform import`'d into that module's state and
 * this component retired.
 */
// The webapp origins allowed to POST an offline memo's recording straight to
// the prod bucket. Prod serves the app on the apex and the app. subdomain,
// the same pair robocall-audio-bucket.ts allows. The dev bucket, which dev
// and every preview stack share, is not Pulumi's, so its rule is set by hand.
export const SPEECH_UPLOAD_ORIGINS = [
  'https://goodparty.org',
  'https://app.goodparty.org',
]

export function createMeetingPipelineBucket({
  environment,
}: MeetingPipelineBucketConfig): {
  bucket: aws.s3.Bucket
} {
  const bucketName = `meeting-pipeline-${environment}`

  const bucket = new aws.s3.Bucket('meeting-pipeline-bucket', {
    bucket: bucketName,
    forceDestroy: false,
  })

  new aws.s3.BucketPublicAccessBlock('meeting-pipeline-pab', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  new aws.s3.BucketServerSideEncryptionConfigurationV2('meeting-pipeline-sse', {
    bucket: bucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: 'AES256',
        },
      },
    ],
  })

  // The browser's cross-origin presigned POST (a multipart form, not a PUT:
  // the POST policy is what lets S3 enforce the size cap). The `<audio>`
  // element that plays text to speech needs no CORS, so this is POST alone.
  new aws.s3.BucketCorsConfigurationV2('meeting-pipeline-cors', {
    bucket: bucket.id,
    corsRules: [
      {
        allowedHeaders: ['*'],
        allowedMethods: ['POST'],
        allowedOrigins: SPEECH_UPLOAD_ORIGINS,
        exposeHeaders: ['ETag'],
        maxAgeSeconds: 3600,
      },
    ],
  })

  return { bucket }
}
