import * as aws from '@pulumi/aws'

export interface EmailOutreachConfig {
  environment: 'dev' | 'prod'
  hostedZoneId: string
  region: string
  accountId: string
}

export const emailOutreachIdentity = (environment: 'dev' | 'prod') =>
  environment === 'prod'
    ? 'outreachmail.goodparty.org'
    : 'outreachmail-dev.goodparty.org'

/**
 * Outreach email's SES sending side: the domain identity with Easy DKIM, a
 * custom MAIL FROM and DMARC, plus the two configuration sets.
 *
 * Dev and prod share one AWS account and region, so the configuration sets are
 * suffixed with the environment. Tenants are not here: gp-api creates one per
 * organization at runtime. Previews get none of this.
 *
 * `outreach` has one event destination, CloudWatch, which is where bounce and
 * complaint numbers are read from. If delivery, open or click data is ever
 * wanted, add a second destination of type Firehose writing to S3. Never SNS:
 * it would put one message per email on the shared queue.
 */
export const createEmailOutreach = ({
  environment,
  hostedZoneId,
  region,
  accountId,
}: EmailOutreachConfig) => {
  const identity = emailOutreachIdentity(environment)
  const mailFromDomain = `bounce.${identity}`

  const emailIdentity = new aws.sesv2.EmailIdentity('email-outreach-identity', {
    emailIdentity: identity,
    dkimSigningAttributes: { nextSigningKeyLength: 'RSA_2048_BIT' },
  })

  const dkimTokens = emailIdentity.dkimSigningAttributes.apply(
    (attributes) => attributes.tokens ?? [],
  )
  ;[0, 1, 2].forEach((index) => {
    new aws.route53.Record(`email-outreach-dkim-${index}`, {
      zoneId: hostedZoneId,
      type: 'CNAME',
      ttl: 300,
      name: dkimTokens.apply(
        (tokens) => `${tokens[index]}._domainkey.${identity}`,
      ),
      records: [
        dkimTokens.apply((tokens) => `${tokens[index]}.dkim.amazonses.com`),
      ],
    })
  })

  const mailFrom = new aws.sesv2.EmailIdentityMailFromAttributes(
    'email-outreach-mail-from',
    {
      emailIdentity: emailIdentity.emailIdentity,
      mailFromDomain,
      behaviorOnMxFailure: 'USE_DEFAULT_VALUE',
    },
  )

  new aws.route53.Record(
    'email-outreach-mail-from-mx',
    {
      zoneId: hostedZoneId,
      type: 'MX',
      ttl: 300,
      name: mailFromDomain,
      records: [`10 feedback-smtp.${region}.amazonses.com`],
    },
    { dependsOn: [mailFrom] },
  )

  new aws.route53.Record('email-outreach-mail-from-spf', {
    zoneId: hostedZoneId,
    type: 'TXT',
    ttl: 300,
    name: mailFromDomain,
    records: ['v=spf1 include:amazonses.com ~all'],
  })

  // No rua until an owner is named for the reports.
  new aws.route53.Record('email-outreach-dmarc', {
    zoneId: hostedZoneId,
    type: 'TXT',
    ttl: 300,
    name: `_dmarc.${identity}`,
    records: ['v=DMARC1; p=none;'],
  })

  // Dev sends to the SES mailbox simulator and a few team inboxes, so SES's
  // account suppression list must not suppress anything there.
  const suppressionOptions =
    environment === 'dev' ? { suppressedReasons: [] } : undefined

  const outreachSetName = `outreach-${environment}`
  const forwardsSetName = `forwards-${environment}`

  const outreachSet = new aws.sesv2.ConfigurationSet('email-outreach-set', {
    configurationSetName: outreachSetName,
    reputationOptions: { reputationMetricsEnabled: true },
    sendingOptions: { sendingEnabled: true },
    suppressionOptions,
  })

  new aws.sesv2.ConfigurationSetEventDestination(
    'email-outreach-set-cloudwatch',
    {
      configurationSetName: outreachSet.configurationSetName,
      eventDestinationName: 'cloudwatch',
      eventDestination: {
        enabled: true,
        matchingEventTypes: [
          'SEND',
          'BOUNCE',
          'COMPLAINT',
          'RENDERING_FAILURE',
        ],
        cloudWatchDestination: {
          dimensionConfigurations: [
            {
              dimensionName: 'outreachEmailId',
              dimensionValueSource: 'MESSAGE_TAG',
              defaultDimensionValue: 'none',
            },
          ],
        },
      },
    },
  )

  new aws.sesv2.ConfigurationSet('email-forwards-set', {
    configurationSetName: forwardsSetName,
    reputationOptions: { reputationMetricsEnabled: true },
    sendingOptions: { sendingEnabled: true },
    suppressionOptions,
  })

  const arn = (resource: string) =>
    `arn:aws:ses:${region}:${accountId}:${resource}`

  const sendResources = [
    arn(`identity/${identity}`),
    arn(`configuration-set/${outreachSetName}`),
    arn(`configuration-set/${forwardsSetName}`),
    arn(`template/${environment}-*`),
    arn(`tenant/${environment}-*/*`),
  ]

  // Statements for the gp-api task role. GetAccount and GetMetricData have no
  // resource to scope to.
  const taskRolePermissions: {
    Effect: 'Allow'
    Action: string[]
    Resource: string[]
  }[] = [
    {
      Effect: 'Allow',
      Action: ['ses:SendBulkEmail', 'ses:SendEmail'],
      Resource: sendResources,
    },
    {
      Effect: 'Allow',
      Action: [
        'ses:CreateEmailTemplate',
        'ses:DeleteEmailTemplate',
        'ses:GetEmailTemplate',
        'ses:UpdateEmailTemplate',
      ],
      Resource: [arn(`template/${environment}-*`)],
    },
    {
      Effect: 'Allow',
      Action: [
        'ses:CreateTenant',
        'ses:GetTenant',
        'ses:CreateTenantResourceAssociation',
      ],
      Resource: [
        arn(`tenant/${environment}-*/*`),
        arn(`identity/${identity}`),
        arn(`configuration-set/${outreachSetName}`),
        arn(`configuration-set/${forwardsSetName}`),
        arn(`template/${environment}-*`),
      ],
    },
    {
      Effect: 'Allow',
      Action: ['ses:GetReputationEntity'],
      Resource: [arn('reputation-entity/*')],
    },
    {
      Effect: 'Allow',
      Action: ['ses:GetAccount'],
      Resource: ['*'],
    },
    {
      Effect: 'Allow',
      Action: ['cloudwatch:GetMetricData'],
      Resource: ['*'],
    },
  ]

  return { taskRolePermissions }
}
