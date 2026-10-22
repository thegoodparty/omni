import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'

export interface AssetsRouterConfig {
  environment: 'dev' | 'prod'
  bucket: aws.s3.BucketV2
  bucketRegionalDomainName: pulumi.Input<string>
  hostedZoneId: string
}

export function createAssetsRouter({
  environment,
  bucket,
  bucketRegionalDomainName,
  hostedZoneId,
}: AssetsRouterConfig) {
  const select = <T>(values: Record<'dev' | 'prod', T>): T =>
    values[environment]

  const domain = select({
    dev: 'assets-dev.goodparty.org',
    prod: 'assets.goodparty.org',
  })

  const oac = new aws.cloudfront.OriginAccessControl('assetsOac', {
    name: `gp-${environment}-assets`,
    description: `Origin Access Control for ${environment}`,
    originAccessControlOriginType: 's3',
    signingBehavior: 'always',
    signingProtocol: 'sigv4',
  })

  const certificateArn = select({
    dev: 'arn:aws:acm:us-east-1:333022194791:certificate/993245c3-7462-45df-9aca-12acc133b9f3',
    prod: 'arn:aws:acm:us-east-1:333022194791:certificate/4ea24fb7-eb1b-486d-8257-61fa08ab21a1',
  })

  const originId = `S3-${domain}`

  // CloudFront ignores S3's `Vary: Origin`, so unless Origin is in the cache
  // key, whichever request fills the cache wins: an <img> load caches a copy
  // with no Access-Control-Allow-Origin and every later fetch() is blocked.
  // Cache-key headers are also forwarded to S3, which is what makes it answer
  // with CORS headers at all.
  const cachePolicy = new aws.cloudfront.CachePolicy('assetsCachePolicy', {
    name: `gp-${environment}-assets`,
    comment: `Assets CDN for ${environment}: query strings and CORS headers`,
    minTtl: 1,
    defaultTtl: 86400,
    maxTtl: 31536000,
    parametersInCacheKeyAndForwardedToOrigin: {
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      cookiesConfig: { cookieBehavior: 'none' },
      headersConfig: {
        headerBehavior: 'whitelist',
        headers: {
          items: [
            'Origin',
            'Access-Control-Request-Method',
            'Access-Control-Request-Headers',
          ],
        },
      },
      queryStringsConfig: { queryStringBehavior: 'all' },
    },
  })

  const distribution = new aws.cloudfront.Distribution('assetsDistribution', {
    enabled: true,
    isIpv6Enabled: true,
    comment: `Assets CDN for ${environment}`,
    aliases: [domain],
    priceClass: 'PriceClass_All',
    origins: [
      {
        domainName: bucketRegionalDomainName,
        originId: originId,
        originAccessControlId: oac.id,
      },
    ],
    defaultCacheBehavior: {
      cachePolicyId: cachePolicy.id,
      targetOriginId: originId,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
      compress: true,
    },
    viewerCertificate: {
      acmCertificateArn: certificateArn,
      sslSupportMethod: 'sni-only',
      minimumProtocolVersion: 'TLSv1.2_2021',
    },
    restrictions: {
      geoRestriction: {
        restrictionType: 'none',
      },
    },
    waitForDeployment: true,
  })

  // Create bucket policy that only allows CloudFront OAC access
  // This restricts direct S3 access - all requests must go through CloudFront
  new aws.s3.BucketPolicy('assetsOacBucketPolicy', {
    bucket: bucket.id,
    policy: aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          principals: [
            {
              type: 'Service',
              identifiers: ['cloudfront.amazonaws.com'],
            },
          ],
          actions: ['s3:GetObject'],
          resources: [pulumi.interpolate`${bucket.arn}/*`],
          conditions: [
            {
              test: 'StringEquals',
              variable: 'AWS:SourceArn',
              values: [distribution.arn],
            },
          ],
        },
      ],
    }).json,
  })

  new aws.route53.Record('assetsARecord', {
    zoneId: hostedZoneId,
    name: domain,
    type: 'A',
    aliases: [
      {
        name: distribution.domainName,
        zoneId: distribution.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  })

  new aws.route53.Record('assetsAAAARecord', {
    zoneId: hostedZoneId,
    name: domain,
    type: 'AAAA',
    aliases: [
      {
        name: distribution.domainName,
        zoneId: distribution.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  })
}
