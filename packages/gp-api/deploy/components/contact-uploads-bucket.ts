import * as aws from '@pulumi/aws'

export interface ContactUploadsBucketConfig {
  environment: 'dev' | 'prod'
}

/**
 * Private bucket for Import contacts: the original CSV a Serve user uploaded
 * and affirmed consent for, at `<organizationSlug>/<uploadId>.csv`. gp-api
 * writes it server-side from `POST /v1/contact-uploads`; nothing reads it
 * from a browser, so there is no CORS rule. All public access is blocked.
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

  return { bucket }
}
