import * as aws from '@pulumi/aws'

// Referenced, not created: this account's GitHub OIDC provider already
// exists (every CI role that assumes into this account federates through
// it). A constant ARN, not a getOpenIdConnectProvider lookup, so previews
// of this program never need iam:ListOpenIDConnectProviders.
const GITHUB_OIDC_PROVIDER_ARN =
  'arn:aws:iam::333022194791:oidc-provider/token.actions.githubusercontent.com'

// gp-marketing's publish workflow presents this subject; kept as `:*` on
// purpose so any ref (including workflow_dispatch single-shard runs) can
// publish. Tightening to `:ref:refs/heads/develop` would block those.
const GP_MARKETING_SUBJECT = 'repo:thegoodparty/gp-marketing:*'

/**
 * The public-read bucket gp-marketing's hourly people-sitemaps generator
 * publishes to, plus the GitHub Actions role its publish workflow assumes
 * to write there. One global bucket (goodparty.org serves the shards via
 * Vercel rewrites), so the prod stack alone creates it.
 *
 * The publisher role deliberately has no s3:DeleteObject: a bad publish
 * can overwrite but never remove previously served shards, and versioning
 * is the rollback mechanism (restore the prior object version).
 */
export const createSitemapsBucket = () => {
  const bucket = new aws.s3.Bucket('gp-marketing-sitemaps-bucket', {
    bucket: 'gp-marketing-sitemaps',
    forceDestroy: false,
  })

  const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(
    'gp-marketing-sitemaps-pab',
    {
      bucket: bucket.id,
      blockPublicAcls: false,
      blockPublicPolicy: false,
      ignorePublicAcls: false,
      restrictPublicBuckets: false,
    },
  )

  new aws.s3.BucketPolicy(
    'gp-marketing-sitemaps-policy',
    {
      bucket: bucket.id,
      policy: bucket.arn.apply((arn) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicReadGetObject',
              Effect: 'Allow',
              Principal: '*',
              Action: 's3:GetObject',
              Resource: `${arn}/*`,
            },
          ],
        }),
      ),
    },
    { dependsOn: [publicAccessBlock] },
  )

  new aws.s3.BucketVersioningV2('gp-marketing-sitemaps-versioning', {
    bucket: bucket.id,
    versioningConfiguration: {
      status: 'Enabled',
    },
  })

  new aws.s3.BucketLifecycleConfigurationV2('gp-marketing-sitemaps-lifecycle', {
    bucket: bucket.id,
    rules: [
      {
        id: 'expire-noncurrent-versions',
        status: 'Enabled',
        filter: {},
        noncurrentVersionExpiration: { noncurrentDays: 30 },
      },
    ],
  })

  const publisherRole = new aws.iam.Role('gp-marketing-sitemaps-publisher', {
    name: 'gp-marketing-sitemaps-publisher',
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Federated: GITHUB_OIDC_PROVIDER_ARN },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            },
            StringLike: {
              'token.actions.githubusercontent.com:sub': GP_MARKETING_SUBJECT,
            },
          },
        },
      ],
    }),
    inlinePolicies: [
      {
        name: 'sitemaps-publish',
        policy: bucket.arn.apply((arn) =>
          JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:PutObject', 's3:GetObject'],
                Resource: `${arn}/*`,
              },
              {
                Effect: 'Allow',
                Action: 's3:ListBucket',
                Resource: arn,
              },
            ],
          }),
        ),
      },
    ],
  })

  return { bucket, publisherRole }
}
