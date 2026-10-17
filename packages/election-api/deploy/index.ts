import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { createService } from './components/service'

const extractDbCredentials = (dbUrl: string) => {
  const url = new URL(dbUrl)
  const username = url.username
  const password = url.password
  const database = url.pathname.slice(1)
  return { username, password, database }
}

export = async () => {
  const config = new pulumi.Config()

  const environment = config.require('environment') as 'dev' | 'prod'
  const imageUri = config.require('imageUri')

  const vpcId = 'vpc-0763fa52c32ebcf6a'
  const hostedZoneId = 'Z10392302OXMPNQLPO07K'
  const vpcSubnetIds = {
    public: ['subnet-07984b965dabfdedc', 'subnet-01c540e6428cdd8db'],
    private: ['subnet-053357b931f0524d4', 'subnet-0bb591861f72dcb7f'],
  }
  const vpcSecurityGroupIds = ['sg-01de8d67b0f0ec787']

  const stage = { dev: 'develop', prod: 'master' }[environment]

  const select = <T>(values: Record<'dev' | 'prod', T>): T =>
    values[environment]

  const secretName = select({
    dev: 'ELECTION_API_DEV',
    prod: 'ELECTION_API_PROD',
  })

  const secretVersion = await aws.secretsmanager.getSecretVersion({
    secretId: secretName,
  })

  const secret: Record<string, string> = JSON.parse(
    secretVersion.secretString || '{}',
  ) as Record<string, string>

  const { username, password, database } = extractDbCredentials(
    secret.DATABASE_URL,
  )
  const rdsCluster = new aws.rds.Cluster('rdsCluster', {
    clusterIdentifier: select({
      dev: 'election-api-db-develop',
      prod: 'election-api-db-prod',
    }),
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineMode: aws.rds.EngineMode.Provisioned,
    engineVersion: '16.8',
    databaseName: database,
    masterUsername: username,
    masterPassword: pulumi.secret(password),
    dbSubnetGroupName: select({
      dev: 'api-rds-subnet-group',
      prod: 'api-master-rds-subnet-group',
    }),
    vpcSecurityGroupIds: [
      select({
        dev: 'sg-0b834a3f7b64950d0',
        prod: 'sg-03783e4adbbee87dc',
      }),
    ],
    storageEncrypted: true,
    serverlessv2ScalingConfiguration: {
      minCapacity: environment === 'prod' ? 1 : 0.5,
      maxCapacity: 64,
    },
    backupRetentionPeriod: select({ dev: 7, prod: 14 }),
    deletionProtection: true,
    skipFinalSnapshot: false,
    finalSnapshotIdentifier: `election-api-db-${stage}-final-snapshot`,
  })

  const rdsInstance = new aws.rds.ClusterInstance('rdsInstance', {
    identifier: select({
      dev: 'tf-20250328152646832200000003',
      prod: 'tf-20250422023552728500000001',
    }),
    clusterIdentifier: rdsCluster.id,
    instanceClass: 'db.serverless',
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: rdsCluster.engineVersion,
  })

  // RDS keeps its event history for 14 days. Copying the cluster's events to
  // a log group keeps them for a year and lets Grafana's CloudWatch data
  // source show them next to the service's own errors.
  const rdsEventsLogGroup = new aws.cloudwatch.LogGroup('rdsEventsLogGroup', {
    name: pulumi.interpolate`/aws/events/rds/${rdsCluster.clusterIdentifier}`,
    retentionInDays: 365,
  })

  new aws.cloudwatch.LogResourcePolicy('rdsEventsLogPolicy', {
    policyName: pulumi.interpolate`eventbridge-to-${rdsCluster.clusterIdentifier}-events`,
    policyDocument: pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: ['events.amazonaws.com', 'delivery.logs.amazonaws.com'],
          },
          Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          Resource: pulumi.interpolate`${rdsEventsLogGroup.arn}:*`,
        },
      ],
    }),
  })

  const rdsEventsRule = new aws.cloudwatch.EventRule('rdsEventsRule', {
    description: pulumi.interpolate`RDS events for ${rdsCluster.clusterIdentifier}`,
    eventPattern: pulumi.jsonStringify({
      source: ['aws.rds'],
      detail: {
        SourceIdentifier: [
          rdsCluster.clusterIdentifier,
          rdsInstance.identifier,
        ],
      },
    }),
  })

  new aws.cloudwatch.EventTarget('rdsEventsTarget', {
    rule: rdsEventsRule.name,
    arn: rdsEventsLogGroup.arn,
  })

  createService({
    environment,
    stage,
    imageUri,
    vpcId,
    securityGroupIds: vpcSecurityGroupIds,
    publicSubnetIds: vpcSubnetIds.public,
    privateSubnetIds: vpcSubnetIds.private,
    hostedZoneId,
    domain: select({
      dev: 'election-api-dev.goodparty.org',
      prod: 'election-api.goodparty.org',
    }),
    certificateArn: select({
      dev: 'arn:aws:acm:us-west-2:333022194791:certificate/b430e283-fcee-4846-9d6c-424e53ea13c4',
      prod: 'arn:aws:acm:us-west-2:333022194791:certificate/b9583af3-ad5d-4efe-8477-31261252e993',
    }),
    secrets: Object.fromEntries(
      Object.keys(secret).map((key) => [
        key,
        pulumi.interpolate`${secretVersion.arn}:${key}::`,
      ]),
    ),
    environmentVariables: {
      PORT: '80',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_ENVIRONMENT: environment,
      SECRETS_MANAGER_KEYS: Object.keys(secret).join(','),
      CORS_ORIGIN: select({
        dev: 'https://dev.goodparty.org',
        prod: 'https://goodparty.org',
      }),
      AWS_REGION: 'us-west-2',
      // Per-task Prisma pool size. The default of 10 exhausted under gp-api
      // fan-out bursts (P2024 "Timed out fetching a connection" → 502s on the
      // org list); 6-16 prod tasks x 25 = 150-400 connections, well within
      // Aurora Serverless v2 capacity.
      PRISMA_CONNECTION_LIMIT: select({ dev: '10', prod: '25' }),
      // Repeated GETs are answered from memory for this long. The data is
      // loaded once a day, and crawler bursts on gp-marketing's public pages
      // repeat the same URLs within minutes (ENG-11302).
      RESPONSE_CACHE_TTL_SECONDS: '300',
      // Clerk instance public key, so M2M tokens verify without fetching
      // Clerk's JWKS. Public, so it lives here and not in the secret.
      CLERK_JWT_KEY: select({
        dev: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5vPRpG6stRNHuJkOX/K3
ukS2x2Hp34QXVnTIsQhgJ/D4T8tw7Ui9KRny2oXWMr9hDBPtVawNwYeqJQzvxucZ
4a3bOpd5cY/Pc2KY2ecO5HErB2+GVcg/JetzVHfXcFeIAppL03PRmztrwETUtBV4
G025CUa+131r8QvYMRdrp5BDtEz/2ZY5vJIgkxptGSZuzgNpIP10Vx4bCAMu3yBa
iaQ0t6Zq6Gixa+yKAtGUTLywT28YRJIo/cdt/98GJhIWENGhJsag4WFOvha5YXS5
Teo/vpW87LUUDxFkF1VWCMZwxhUzOyI3ZTKZSBsO8sZK9HtC1CAKHv5CAck47AIn
gQIDAQAB
-----END PUBLIC KEY-----`,
        prod: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv7mX9LgkMjP5eeqaufE/
gKslsuuKY8rRVlYfLiIGHFo6UbB8Nm3ZY4VDHNGCP8ewE0CrEuY5LaRbYaIuDeB5
9dWfgTIbieUBHPr2lmA1crMyRKVQEkYNHFGyvoR6wF3m8FUbiT03gEsnTsmKdeFl
rmbyjAacxbn75BLOwZZm1abvRxPXj6/MwbahCKVSvtrBdsjhQBxxOv5+9UFhQ14p
WedQREHPKVj/GBX8+0NOxdKibVUlppnVyXbDLG31UNXi5iFQVJ52r6B/+7KuZQya
4RFIVMAkgqfj2C8dnFR2sQS2NkR9DqQabf6aY4Yme2/RRT5489atX1kUFh1Tt167
jwIDAQAB
-----END PUBLIC KEY-----`,
      }),
    },
    permissions: [
      {
        Effect: 'Allow',
        Action: [
          'ssmmessages:OpenDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:CreateControlChannel',
        ],
        Resource: ['*'],
      },
    ],
  })
}
