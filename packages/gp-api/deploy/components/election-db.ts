import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

// The election Aurora cluster, adopted from the election-api stack by import
// (election-api consolidation, phase 7). Nothing here is recreated: every
// physical name below is the one election-api's stack created, and the tags
// keep its Project tag so the import matches AWS exactly.
//
// The master password is not managed here. The cluster keeps the one it has,
// and gp-api reads it from ELECTION_DATABASE_URL in its own secret.
const physical = {
  dev: {
    cluster: 'election-api-db-develop',
    instance: 'tf-20250328152646832200000003',
    subnetGroup: 'api-rds-subnet-group',
    securityGroup: 'sg-0b834a3f7b64950d0',
    minCapacity: 0.5,
    backupRetentionPeriod: 7,
    eventsRule: 'rdsEventsRule-5cba80c',
    eventsTarget: 'rdsEventsTarget-b3a95d7',
  },
  prod: {
    cluster: 'election-api-db-prod',
    instance: 'tf-20250422023552728500000001',
    subnetGroup: 'api-master-rds-subnet-group',
    securityGroup: 'sg-03783e4adbbee87dc',
    minCapacity: 1,
    backupRetentionPeriod: 14,
    eventsRule: 'rdsEventsRule-4235df3',
    eventsTarget: 'rdsEventsTarget-8ef39c3',
  },
}

export const createElectionDb = (environment: 'dev' | 'prod') => {
  const p = physical[environment]
  const tags = { Project: 'election-api' }
  const logGroupName = `/aws/events/rds/${p.cluster}`

  const cluster = new aws.rds.Cluster(
    'electionDbCluster',
    {
      clusterIdentifier: p.cluster,
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      engineVersion: '16.11',
      databaseName: 'gpdb',
      masterUsername: 'gpuser',
      dbSubnetGroupName: p.subnetGroup,
      vpcSecurityGroupIds: [p.securityGroup],
      storageEncrypted: true,
      serverlessv2ScalingConfiguration: {
        minCapacity: p.minCapacity,
        maxCapacity: 64,
      },
      backupRetentionPeriod: p.backupRetentionPeriod,
      deletionProtection: true,
      tags,
    },
    {
      import: p.cluster,
      protect: true,
      // AWS applies minor engine upgrades on its own; Pulumi must not try to
      // roll them back. The write-forwarding flags are provider defaults the
      // cluster has never set. skipFinalSnapshot exists only in Pulumi state
      // and an import reads it as true; the follow-up that drops `import`
      // sets it to false with a final snapshot name.
      ignoreChanges: [
        'engineVersion',
        'enableGlobalWriteForwarding',
        'enableLocalWriteForwarding',
        'skipFinalSnapshot',
      ],
    },
  )

  const instance = new aws.rds.ClusterInstance(
    'electionDbInstance',
    {
      identifier: p.instance,
      clusterIdentifier: cluster.id,
      instanceClass: 'db.serverless',
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineVersion: cluster.engineVersion,
      tags,
    },
    {
      import: p.instance,
      protect: true,
      ignoreChanges: ['engineVersion', 'forceDestroy'],
    },
  )

  // RDS keeps its event history for 14 days. Copying the cluster's events to
  // a log group keeps them for a year and lets Grafana's CloudWatch data
  // source show them next to the service's own errors.
  const logGroup = new aws.cloudwatch.LogGroup(
    'electionDbEventsLogGroup',
    { name: logGroupName, retentionInDays: 365, tags },
    { import: logGroupName },
  )

  new aws.cloudwatch.LogResourcePolicy(
    'electionDbEventsLogPolicy',
    {
      policyName: `eventbridge-to-${p.cluster}-events`,
      policyDocument: pulumi.jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: ['events.amazonaws.com', 'delivery.logs.amazonaws.com'],
            },
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: pulumi.interpolate`${logGroup.arn}:*`,
          },
        ],
      }),
    },
    { import: `eventbridge-to-${p.cluster}-events` },
  )

  const rule = new aws.cloudwatch.EventRule(
    'electionDbEventsRule',
    {
      name: p.eventsRule,
      description: `RDS events for ${p.cluster}`,
      eventPattern: JSON.stringify({
        source: ['aws.rds'],
        detail: { SourceIdentifier: [p.cluster, p.instance] },
      }),
      tags,
    },
    { import: p.eventsRule },
  )

  new aws.cloudwatch.EventTarget(
    'electionDbEventsTarget',
    {
      rule: rule.name,
      targetId: p.eventsTarget,
      arn: logGroup.arn,
    },
    { import: `${p.eventsRule}/${p.eventsTarget}` },
  )

  return { cluster, instance }
}
