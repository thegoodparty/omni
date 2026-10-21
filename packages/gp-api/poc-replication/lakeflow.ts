import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

type LakeflowArgs = {
  name: string
  config: pulumi.Config
  cluster: aws.rds.Cluster
  writer: aws.rds.ClusterInstance
  securityGroup: aws.ec2.SecurityGroup
  alarmTopic: aws.sns.Topic
  slotLagAlarmBytes: number
  walDiskAlarmBytes: number
}

export const lakeflow = ({
  name,
  config,
  cluster,
  writer,
  securityGroup,
  alarmTopic,
  slotLagAlarmBytes,
  walDiskAlarmBytes,
}: LakeflowArgs): Record<string, pulumi.Input<unknown>> => {
  const gatewayCidrs = config.getObject<string[]>('lakeflowGatewayCidrs') ?? []
  const failoverReader = config.getBoolean('lakeflowFailoverReader') ?? false

  const replicationSecret = new aws.secretsmanager.Secret(
    `${name}-lakeflow-replication-user`,
    {
      name: `${name}-lakeflow-replication-user`,
      description:
        'Lakeflow Connect replication user for the POC cluster. Value set by the DB admin, never by Pulumi.',
      recoveryWindowInDays: 0,
    },
  )

  gatewayCidrs.forEach(
    (cidr, i) =>
      new aws.vpc.SecurityGroupIngressRule(`${name}-db-lakeflow-gateway-${i}`, {
        securityGroupId: securityGroup.id,
        description: 'lakeflow connect ingestion gateway (classic compute)',
        ipProtocol: 'tcp',
        fromPort: 5432,
        toPort: 5432,
        cidrIpv4: cidr,
      }),
  )

  if (!failoverReader) {
    return { lakeflowReplicationSecretArn: replicationSecret.arn }
  }

  const reader = new aws.rds.ClusterInstance(
    `${name}-lakeflow-reader`,
    {
      identifier: `${name}-reader`,
      clusterIdentifier: cluster.id,
      instanceClass: 'db.serverless',
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineVersion: cluster.engineVersion,
      publiclyAccessible: false,
      promotionTier: 0,
      applyImmediately: true,
    },
    { ignoreChanges: ['engineVersion'], dependsOn: [writer] },
  )

  const readerAlarms = [
    { metricName: 'OldestReplicationSlotLag', threshold: slotLagAlarmBytes },
    { metricName: 'ReplicationSlotDiskUsage', threshold: walDiskAlarmBytes },
    { metricName: 'TransactionLogsDiskUsage', threshold: walDiskAlarmBytes },
  ].map(
    ({ metricName, threshold }) =>
      new aws.cloudwatch.MetricAlarm(`${name}-reader-${metricName}`, {
        name: `${name}-reader-${metricName}`,
        alarmDescription: `${metricName} on the failover reader, which holds the slot after a failover`,
        namespace: 'AWS/RDS',
        metricName,
        dimensions: { DBInstanceIdentifier: reader.identifier },
        statistic: 'Maximum',
        period: 300,
        evaluationPeriods: 1,
        threshold,
        comparisonOperator: 'GreaterThanThreshold',
        treatMissingData: 'notBreaching',
        alarmActions: [alarmTopic.arn],
        okActions: [alarmTopic.arn],
      }),
  )

  return {
    lakeflowReplicationSecretArn: replicationSecret.arn,
    lakeflowReaderIdentifier: reader.identifier,
    lakeflowReaderAlarmNames: readerAlarms.map((alarm) => alarm.name),
  }
}
