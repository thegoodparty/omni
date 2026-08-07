import * as aws from '@pulumi/aws'

export interface CampaignPlanSharesBucketConfig {
  environment: 'dev' | 'prod'
}

/**
 * Private bucket for shared campaign-plan PDFs. The webapp uploads the
 * client-rendered PDF through gp-api (multipart); recipients fetch it back
 * through the public `GET /v1/campaign-plan-shares/:campaignId/:fileName`
 * endpoint, which streams the object server-side. Nothing talks to this
 * bucket from the browser, so there is no CORS configuration.
 *
 * The dev bucket is adopted from one created via CLI during development;
 * Pulumi takes it over on first deploy (one-time `pulumi import` if the
 * create errors out as "already owned"). The prod bucket is created fresh
 * on their first deploy.
 */
export function createCampaignPlanSharesBucket({
  environment,
}: CampaignPlanSharesBucketConfig): { bucket: aws.s3.Bucket } {
  const bucketName = `campaign-plan-shares-${environment}`

  const bucket = new aws.s3.Bucket('campaign-plan-shares-bucket', {
    bucket: bucketName,
    forceDestroy: false,
  })

  new aws.s3.BucketPublicAccessBlock('campaign-plan-shares-pab', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  new aws.s3.BucketServerSideEncryptionConfigurationV2(
    'campaign-plan-shares-sse',
    {
      bucket: bucket.id,
      rules: [
        {
          applyServerSideEncryptionByDefault: {
            sseAlgorithm: 'AES256',
          },
        },
      ],
    },
  )

  new aws.s3.BucketVersioningV2('campaign-plan-shares-versioning', {
    bucket: bucket.id,
    versioningConfiguration: {
      status: 'Enabled',
    },
  })

  new aws.s3.BucketLifecycleConfigurationV2('campaign-plan-shares-lifecycle', {
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
