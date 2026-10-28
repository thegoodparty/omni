import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { emailOutreachIdentity } from './email-outreach'

type EmailEnvironment = 'dev' | 'prod'

const ENVIRONMENTS: EmailEnvironment[] = ['dev', 'prod']
const RECEIPT_RULE_SET_NAME = 'outreach-inbound'

export const emailInboundName = (environment: EmailEnvironment) =>
  `email-inbound-${environment}`

// S3 bucket names are global across all AWS accounts, and the bare
// `email-inbound-dev` was already taken, so the bucket is namespaced under
// goodparty (as the chat-attachments bucket is). The topic is account-scoped
// and keeps the short name.
export const emailInboundBucketName = (environment: EmailEnvironment) =>
  `goodparty-${emailInboundName(environment)}`

export const emailInboundTopicArn = (
  environment: EmailEnvironment,
  region: string,
  accountId: string,
) => `arn:aws:sns:${region}:${accountId}:${emailInboundName(environment)}`

export interface EmailInboundConfig {
  environment: EmailEnvironment
  hostedZoneId: string
  region: string
  accountId: string
  webhookUrl: string
  // The gp-api service. The subscription waits for it so the webhook is
  // answering, with EMAIL_INBOUND_TOPIC_ARN set, when SNS sends the
  // confirmation; a confirmation that gets a 503 is not retried for long.
  service: pulumi.Resource
}

/**
 * Inbound replies to outreach email: SES receives mail for the identity, writes
 * it to this environment's bucket and notifies this environment's SNS topic,
 * which POSTs to gp-api's webhook.
 *
 * SES allows one active receipt rule set per account and region, and dev and
 * prod share both, so the prod stack owns the set and holds a rule for each
 * environment. That rule names dev's bucket and topic by their fixed names, so
 * the dev stack has to deploy first, which the release train guarantees. It
 * also means dev replies start landing only after the first prod deploy
 * following this change; the dev subscription itself confirms on the dev
 * deploy.
 */
export const createEmailInbound = ({
  environment,
  hostedZoneId,
  region,
  accountId,
  webhookUrl,
  service,
}: EmailInboundConfig) => {
  const name = emailInboundName(environment)
  const bucketName = emailInboundBucketName(environment)
  const identity = emailOutreachIdentity(environment)
  const topicArn = emailInboundTopicArn(environment, region, accountId)
  const sesSourceAccount = { 'AWS:SourceAccount': accountId }

  const topic = new aws.sns.Topic('email-inbound-topic', { name })

  const topicPolicy = new aws.sns.TopicPolicy('email-inbound-topic-policy', {
    arn: topic.arn,
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowSesPublish',
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 'sns:Publish',
          Resource: topicArn,
          Condition: { StringEquals: sesSourceAccount },
        },
      ],
    }),
  })

  new aws.sns.TopicSubscription(
    'email-inbound-subscription',
    {
      topic: topic.arn,
      protocol: 'https',
      endpoint: webhookUrl,
      // About an hour of retries: 2 at 20s, 4 backing off to 10 minutes, then
      // 5 at 10 minutes.
      deliveryPolicy: JSON.stringify({
        healthyRetryPolicy: {
          minDelayTarget: 20,
          maxDelayTarget: 600,
          numRetries: 11,
          numNoDelayRetries: 0,
          numMinDelayRetries: 2,
          numMaxDelayRetries: 5,
          backoffFunction: 'exponential',
        },
      }),
    },
    { dependsOn: [topicPolicy, service] },
  )

  const bucket = new aws.s3.Bucket('email-inbound-bucket', {
    bucket: bucketName,
    forceDestroy: false,
  })

  new aws.s3.BucketPublicAccessBlock('email-inbound-pab', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  new aws.s3.BucketServerSideEncryptionConfigurationV2('email-inbound-sse', {
    bucket: bucket.id,
    rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }],
  })

  new aws.s3.BucketLifecycleConfigurationV2('email-inbound-lifecycle', {
    bucket: bucket.id,
    rules: [
      {
        id: 'expire-inbound',
        status: 'Enabled',
        filter: {},
        expiration: { days: 30 },
      },
    ],
  })

  const bucketPolicy = new aws.s3.BucketPolicy('email-inbound-bucket-policy', {
    bucket: bucket.id,
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowSesPut',
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 's3:PutObject',
          Resource: `arn:aws:s3:::${bucketName}/*`,
          Condition: {
            StringEquals: sesSourceAccount,
            StringLike: {
              'AWS:SourceArn': `arn:aws:ses:${region}:${accountId}:receipt-rule-set/${RECEIPT_RULE_SET_NAME}:receipt-rule/*`,
            },
          },
        },
      ],
    }),
  })

  new aws.route53.Record('email-inbound-mx', {
    zoneId: hostedZoneId,
    type: 'MX',
    ttl: 300,
    name: identity,
    records: [`10 inbound-smtp.${region}.amazonaws.com`],
  })

  if (environment === 'prod') {
    const ruleSet = new aws.ses.ReceiptRuleSet('email-inbound-rule-set', {
      ruleSetName: RECEIPT_RULE_SET_NAME,
    })

    new aws.ses.ActiveReceiptRuleSet('email-inbound-active-rule-set', {
      ruleSetName: ruleSet.ruleSetName,
    })

    ENVIRONMENTS.forEach((ruleEnvironment) => {
      new aws.ses.ReceiptRule(
        `email-inbound-rule-${ruleEnvironment}`,
        {
          name: `inbound-${ruleEnvironment}`,
          ruleSetName: ruleSet.ruleSetName,
          recipients: [emailOutreachIdentity(ruleEnvironment)],
          enabled: true,
          scanEnabled: true,
          s3Actions: [
            {
              position: 1,
              bucketName: emailInboundBucketName(ruleEnvironment),
              topicArn: emailInboundTopicArn(
                ruleEnvironment,
                region,
                accountId,
              ),
            },
          ],
        },
        { dependsOn: [bucketPolicy, topicPolicy] },
      )
    })
  }

  return { bucketName }
}
