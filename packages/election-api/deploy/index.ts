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

  new aws.rds.ClusterInstance('rdsInstance', {
    identifier: select({
      dev: 'tf-20250328152646832200000003',
      prod: 'tf-20250422023552728500000001',
    }),
    clusterIdentifier: rdsCluster.id,
    instanceClass: 'db.serverless',
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: rdsCluster.engineVersion,
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
      SECRET_NAMES: Object.keys(secret).join(','),
      CORS_ORIGIN: select({
        dev: 'https://dev.goodparty.org',
        prod: 'https://goodparty.org',
      }),
      AWS_REGION: 'us-west-2',
      // Per-task Prisma pool size. The default of 10 exhausted under gp-api
      // fan-out bursts (P2024 "Timed out fetching a connection" → 502s on the
      // org list); 2 prod tasks x 25 = 50 connections, well within Aurora
      // Serverless v2 capacity.
      PRISMA_CONNECTION_LIMIT: select({ dev: '10', prod: '25' }),
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
