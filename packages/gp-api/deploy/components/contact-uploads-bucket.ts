import * as aws from '@pulumi/aws'

export interface ContactUploadsBucketConfig {
  environment: 'dev' | 'prod'
}

/**
 * Private bucket for Import contacts: the original CSV a Serve user uploaded
 * and affirmed consent for, at `<organizationSlug>/<uploadId>.csv`. The
 * browser PUTs it straight here with the URL from
 * `POST /v1/contact-uploads/presign`, because the webapp's `/api` proxy on
 * Vercel caps request bodies at 4.5 MB; gp-api reads it back server-side.
 * All public access is blocked.
 *
 * No object expiry: the file is the record of what was uploaded and lets
 * matching be re-run. Only noncurrent versions expire, so a deleted
 * organization's files are gone for good after 30 days.
 */
export function createContactUploadsBucket({
  environment,
}: ContactUploadsBucketConfig): {
  bucket: aws.s3.Bucket
} {
  const select = <T>(values: Record<'dev' | 'prod', T>): T =>
    values[environment]

  const bucket = new aws.s3.Bucket('contact-uploads-bucket', {
    bucket: `gp-api-contact-uploads-${environment}`,
    forceDestroy: false,
  })

  new aws.s3.BucketPublicAccessBlock('contact-uploads-pab', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  new aws.s3.BucketServerSideEncryptionConfigurationV2('contact-uploads-sse', {
    bucket: bucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: 'AES256',
        },
      },
    ],
  })

  new aws.s3.BucketVersioningV2('contact-uploads-versioning', {
    bucket: bucket.id,
    versioningConfiguration: {
      status: 'Enabled',
    },
  })

  new aws.s3.BucketLifecycleConfigurationV2('contact-uploads-lifecycle', {
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

  // The webapp origins that serve /dashboard. PR previews share the dev
  // bucket, so dev also takes the webapp's Vercel preview hosts. The marketing
  // apex goodparty.org does not serve the dashboard.
  new aws.s3.BucketCorsConfigurationV2('contact-uploads-cors', {
    bucket: bucket.id,
    corsRules: [
      {
        allowedHeaders: ['content-type'],
        allowedMethods: ['PUT'],
        allowedOrigins: select({
          dev: [
            'http://localhost:4000',
            'https://dev.goodparty.org',
            'https://gp-ui-*-good-party.vercel.app',
          ],
          prod: ['https://app.goodparty.org'],
        }),
        maxAgeSeconds: 3600,
      },
    ],
  })

  return { bucket }
}
