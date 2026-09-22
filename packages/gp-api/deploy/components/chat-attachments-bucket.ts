import * as aws from '@pulumi/aws'

export interface ChatAttachmentsBucketConfig {
  environment: 'dev' | 'prod'
}

/**
 * Private bucket for chat attachment uploads (PDFs, Word docs, images) and
 * URL snapshots. The browser POSTs directly via presigned POST from
 * `POST /v1/chats/:conversationId/attachments/presign`; gp-api reads back
 * server-side for text extraction. All public access is blocked.
 *
 * No object expiry — attachments are cited inline in conversation history and
 * must remain readable for as long as the conversation exists. Only noncurrent
 * versions are expired to bound storage cost.
 */
export function createChatAttachmentsBucket({
  environment,
}: ChatAttachmentsBucketConfig): {
  bucket: aws.s3.Bucket
} {
  const select = <T>(values: Record<'dev' | 'prod', T>): T =>
    values[environment]

  // goodparty-prefixed, unlike the sibling buckets this component was cloned
  // from: S3 bucket names are a single global namespace across every AWS
  // account, and the bare `chat-attachments-dev` is owned by someone else —
  // the deploy failed live with BucketAlreadyExists. The siblings' generic
  // names only ever worked by luck.
  const bucketName = `goodparty-chat-attachments-${environment}`

  const bucket = new aws.s3.Bucket('chat-attachments-bucket', {
    bucket: bucketName,
    forceDestroy: false,
  })

  new aws.s3.BucketPublicAccessBlock('chat-attachments-pab', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  new aws.s3.BucketServerSideEncryptionConfigurationV2('chat-attachments-sse', {
    bucket: bucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: 'AES256',
        },
      },
    ],
  })

  new aws.s3.BucketVersioningV2('chat-attachments-versioning', {
    bucket: bucket.id,
    versioningConfiguration: {
      status: 'Enabled',
    },
  })

  new aws.s3.BucketLifecycleConfigurationV2('chat-attachments-lifecycle', {
    bucket: bucket.id,
    rules: [
      {
        id: 'expire-noncurrent-versions',
        status: 'Enabled',
        filter: {},
        noncurrentVersionExpiration: {
          noncurrentDays: 30,
        },
      },
    ],
  })

  new aws.s3.BucketCorsConfigurationV2('chat-attachments-cors', {
    bucket: bucket.id,
    corsRules: [
      {
        allowedHeaders: ['*'],
        allowedMethods: ['POST'],
        allowedOrigins: select({
          dev: ['http://localhost:4000', 'https://dev.goodparty.org'],
          prod: ['https://goodparty.org', 'https://app.goodparty.org'],
        }),
        exposeHeaders: ['ETag'],
        maxAgeSeconds: 3600,
      },
    ],
  })

  return { bucket }
}
