import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

// Persistent shared Aurora cluster for all gp-api PR previews.
// Deployed once, out-of-band — not touched by per-PR or develop stacks.
// Per-PR databases (gpdb_pr_<n>) are created against this cluster by the
// preview entrypoint (ticket 1.2); this stack only provisions the cluster.

export = async () => {
  const vpcId = 'vpc-0763fa52c32ebcf6a'
  const vpcCidr = '10.0.0.0/16'

  // Private subnets from the shared VPC — same as the per-PR stacks.
  const privateSubnetIds = [
    'subnet-053357b931f0524d4',
    'subnet-0bb591861f72dcb7f',
  ]

  // App security group that ECS tasks run under; must reach the cluster on 5432.
  const appSecurityGroupId = 'sg-01de8d67b0f0ec787'

  const secretVersion = await aws.secretsmanager.getSecretVersion({
    secretId: 'GP_API_DEV',
  })

  // JSON.parse returns any — AWS secret is always a string-keyed object,
  // validated by the DB_PASSWORD key check below
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const secret: Record<string, string> = JSON.parse(
    secretVersion.secretString || '{}',
  ) as Record<string, string>

  if (!secret.DB_PASSWORD) {
    throw new Error('DB_PASSWORD must be set in the GP_API_DEV secret.')
  }

  const rdsSecurityGroup = new aws.ec2.SecurityGroup(
    'previewSharedRdsSecurityGroup',
    {
      name: 'api-preview-shared-rds-security-group',
      description: 'Allow traffic to the shared preview Aurora cluster',
      vpcId,
      ingress: [
        {
          protocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          securityGroups: [appSecurityGroupId],
        },
        {
          protocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          cidrBlocks: [vpcCidr],
        },
        {
          protocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          description: 'databricks via vpc peering',
          cidrBlocks: ['172.16.0.0/16'],
        },
      ],
      egress: [
        {
          protocol: '-1',
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ['0.0.0.0/0'],
        },
      ],
    },
  )

  const subnetGroup = new aws.rds.SubnetGroup('previewSharedSubnetGroup', {
    name: 'api-preview-shared-rds-subnet-group',
    subnetIds: privateSubnetIds,
    tags: {
      Name: 'api-preview-shared-rds-subnet-group',
    },
  })

  const rdsCluster = new aws.rds.Cluster(
    'previewSharedCluster',
    {
      clusterIdentifier: 'gp-api-preview-shared',
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      engineVersion: '16.8',
      // No databaseName: the preview entrypoint (ticket 1.2) creates per-PR
      // databases (gpdb_pr_<n>) against the default postgres maintenance DB,
      // so no single initial database is provisioned here.
      masterUsername: 'gpuser',
      masterPassword: pulumi.secret(secret.DB_PASSWORD),
      dbSubnetGroupName: subnetGroup.name,
      vpcSecurityGroupIds: [rdsSecurityGroup.id],
      storageEncrypted: true,
      serverlessv2ScalingConfiguration: {
        minCapacity: 0.5,
        maxCapacity: 64,
      },
      backupRetentionPeriod: 1,
      deletionProtection: true,
      skipFinalSnapshot: true,
    },
    // Write-once: a rotated DB_PASSWORD must not ModifyDBCluster the live
    // shared cluster, which would break every connected preview.
    { ignoreChanges: ['masterPassword'] },
  )

  const rdsInstance = new aws.rds.ClusterInstance('previewSharedInstance', {
    clusterIdentifier: rdsCluster.id,
    instanceClass: 'db.serverless',
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: rdsCluster.engineVersion,
  })

  // DatabaseConnections is instance-level (DBInstanceIdentifier).
  // ServerlessDatabaseCapacity is reported at the cluster level too, so it
  // alarms on DBClusterIdentifier.
  //
  // Thresholds: 0.5-ACU Aurora Serverless v2 supports ~100 max connections;
  // alarm at 80 catches sustained pressure while Aurora auto-scales. ACU
  // alarm at 56 = 87.5% of maxCapacity (64).
  //
  // alarmActions is empty — no SNS topic exists yet. Ops follow-up: create
  // one, subscribe it to Slack/Lambda, add the ARN here, re-apply the stack.
  new aws.cloudwatch.MetricAlarm('previewSharedConnectionsAlarm', {
    name: 'gp-api-preview-shared-high-connections',
    alarmDescription:
      'Shared preview Aurora instance: connections nearing 0.5-ACU ceiling ' +
      '(~100 max). Raise minCapacity or reduce connection_limit per service.',
    namespace: 'AWS/RDS',
    metricName: 'DatabaseConnections',
    dimensions: { DBInstanceIdentifier: rdsInstance.id },
    statistic: 'Maximum',
    period: 60,
    evaluationPeriods: 3,
    datapointsToAlarm: 3,
    threshold: 80,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    treatMissingData: 'notBreaching',
    alarmActions: [],
  })

  new aws.cloudwatch.MetricAlarm('previewSharedCapacityAlarm', {
    name: 'gp-api-preview-shared-high-capacity',
    alarmDescription:
      'Shared preview Aurora cluster: ACU approaching maxCapacity of 64. ' +
      'Consider raising maxCapacity or reducing load.',
    namespace: 'AWS/RDS',
    metricName: 'ServerlessDatabaseCapacity',
    dimensions: { DBClusterIdentifier: rdsCluster.clusterIdentifier },
    statistic: 'Maximum',
    period: 60,
    evaluationPeriods: 3,
    datapointsToAlarm: 3,
    threshold: 56,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    treatMissingData: 'notBreaching',
    alarmActions: [],
  })

  // pulumi.output coerces these to the top-level @pulumi/pulumi Output type;
  // aws.rds.Cluster's own Output type is bundled under @pulumi/aws and is not
  // nameable in the exported program type (tsc TS2742).
  return {
    clusterEndpoint: pulumi.output(rdsCluster.endpoint),
    clusterIdentifier: pulumi.output(rdsCluster.clusterIdentifier),
    instanceId: pulumi.output(rdsInstance.id),
  }
}
