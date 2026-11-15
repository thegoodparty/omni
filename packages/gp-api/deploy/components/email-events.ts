import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

type EmailEnvironment = 'dev' | 'prod'

// S3 names are global, so the bucket carries the goodparty prefix like the
// inbound one.
export const emailEventsBucketName = (environment: EmailEnvironment) =>
  `goodparty-ses-events-${environment}`

export interface EmailEventsConfig {
  environment: EmailEnvironment
  region: string
  accountId: string
  configurationSetName: pulumi.Input<string>
}

/**
 * Per-email SES events (delivery, bounce, complaint, open, click) for the
 * `outreach-<env>` configuration set: a second event destination sends them to
 * Firehose, which writes gzipped JSON files to this environment's bucket, and a
 * gp-api cron reads the files. Never through the shared SQS queue.
 *
 * Files land under `events/YYYY/MM/DD/HH/` (UTC, Firehose's default layout)
 * and expire after 90 days. Records that fail delivery land under `errors/`.
 */
export const createEmailEvents = ({
  environment,
  region,
  accountId,
  configurationSetName,
}: EmailEventsConfig) => {
  const name = `ses-events-${environment}`
  const bucketName = emailEventsBucketName(environment)
  const streamArn = `arn:aws:firehose:${region}:${accountId}:deliverystream/${name}`

  const bucket = new aws.s3.Bucket('email-events-bucket', {
    bucket: bucketName,
    forceDestroy: false,
  })

  new aws.s3.BucketPublicAccessBlock('email-events-pab', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  new aws.s3.BucketServerSideEncryptionConfigurationV2('email-events-sse', {
    bucket: bucket.id,
    rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
  })

  new aws.s3.BucketLifecycleConfigurationV2('email-events-lifecycle', {
    bucket: bucket.id,
    rules: [
      {
        id: 'expire-events',
        status: 'Enabled',
        filter: {},
        expiration: { days: 90 },
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
      },
    ],
  })

  const firehoseRole = new aws.iam.Role('email-events-firehose-role', {
    name: `${name}-firehose`,
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'firehose.amazonaws.com' },
          Action: 'sts:AssumeRole',
          Condition: { StringEquals: { 'sts:ExternalId': accountId } },
        },
      ],
    }),
  })

  const firehoseRolePolicy = new aws.iam.RolePolicy(
    'email-events-firehose-policy',
    {
      role: firehoseRole.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              's3:AbortMultipartUpload',
              's3:GetBucketLocation',
              's3:GetObject',
              's3:ListBucket',
              's3:ListBucketMultipartUploads',
              's3:PutObject',
            ],
            Resource: [
              `arn:aws:s3:::${bucketName}`,
              `arn:aws:s3:::${bucketName}/*`,
            ],
          },
        ],
      }),
    },
  )

  const stream = new aws.kinesis.FirehoseDeliveryStream(
    'email-events-stream',
    {
      name,
      destination: 'extended_s3',
      serverSideEncryption: { enabled: true, keyType: 'AWS_OWNED_CMK' },
      extendedS3Configuration: {
        bucketArn: bucket.arn,
        roleArn: firehoseRole.arn,
        prefix: 'events/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/',
        bufferingInterval: 60,
        bufferingSize: 5,
        compressionFormat: 'GZIP',
      },
    },
    { dependsOn: [firehoseRolePolicy] },
  )

  const configurationSetArn = pulumi.interpolate`arn:aws:ses:${region}:${accountId}:configuration-set/${configurationSetName}`

  const sesRole = new aws.iam.Role('email-events-ses-role', {
    name: `${name}-ses`,
    assumeRolePolicy: pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 'sts:AssumeRole',
          Condition: {
            StringEquals: {
              'AWS:SourceAccount': accountId,
              'AWS:SourceArn': configurationSetArn,
            },
          },
        },
      ],
    }),
  })

  const sesRolePolicy = new aws.iam.RolePolicy('email-events-ses-policy', {
    role: sesRole.id,
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
          Resource: [streamArn],
        },
      ],
    }),
  })

  // No trackingOptions: opens and clicks go through SES's default tracking
  // domain. A custom one needs CloudFront and a us-east-1 certificate to stay
  // on HTTPS.
  new aws.sesv2.ConfigurationSetEventDestination(
    'email-outreach-set-firehose',
    {
      configurationSetName,
      eventDestinationName: 'firehose',
      eventDestination: {
        enabled: true,
        matchingEventTypes: [
          'DELIVERY',
          'BOUNCE',
          'COMPLAINT',
          'OPEN',
          'CLICK',
        ],
        kinesisFirehoseDestination: {
          deliveryStreamArn: stream.arn,
          iamRoleArn: sesRole.arn,
        },
      },
    },
    { dependsOn: [sesRolePolicy] },
  )
}
