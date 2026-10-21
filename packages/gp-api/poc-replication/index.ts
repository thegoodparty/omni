import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { createDms } from './dms'

export = () => {
  const config = new pulumi.Config()

  const vpcId = config.get('vpcId') ?? 'vpc-0763fa52c32ebcf6a'
  const privateSubnetIds = config.getObject<string[]>('privateSubnetIds') ?? [
    'subnet-053357b931f0524d4',
    'subnet-0bb591861f72dcb7f',
  ]
  const vpnSecurityGroupId =
    config.get('vpnSecurityGroupId') ?? 'sg-0fa26a075716d3173'
  const databricksPeeringCidr =
    config.get('databricksPeeringCidr') ?? '172.16.0.0/16'
  const slotLagAlarmBytes = config.getNumber('slotLagAlarmBytes') ?? 1024 ** 3
  const walDiskAlarmBytes =
    config.getNumber('walDiskAlarmBytes') ?? 5 * 1024 ** 3
  const alarmEmail = config.get('alarmEmail')

  const name = 'gp-poc-replication'
  const parameterGroupFamily = 'aurora-postgresql17'

  const vpc = aws.ec2.getVpcOutput({ id: vpcId })
  const subnets = aws.ec2.getSubnetsOutput({
    filters: [
      { name: 'vpc-id', values: [vpc.id] },
      { name: 'subnet-id', values: privateSubnetIds },
    ],
  })

  const engineVersion =
    config.get('engineVersion') ??
    aws.rds.getEngineVersionOutput({
      engine: 'aurora-postgresql',
      parameterGroupFamily,
      latest: true,
    }).versionActual

  const parameterGroup = new aws.rds.ClusterParameterGroup(`${name}-params`, {
    name: `${name}-params`,
    family: parameterGroupFamily,
    description: 'gp-api replication POC: logical replication on',
    parameters: [
      {
        name: 'rds.logical_replication',
        value: '1',
        applyMethod: 'pending-reboot',
      },
    ],
  })

  const securityGroup = new aws.ec2.SecurityGroup(`${name}-db`, {
    name: `${name}-db`,
    description: 'gp-api replication POC Aurora cluster',
    vpcId: vpc.id,
  })

  new aws.vpc.SecurityGroupEgressRule(`${name}-db-egress`, {
    securityGroupId: securityGroup.id,
    ipProtocol: '-1',
    cidrIpv4: '0.0.0.0/0',
  })

  new aws.vpc.SecurityGroupIngressRule(`${name}-db-vpn`, {
    securityGroupId: securityGroup.id,
    description: 'openvpn server (engineer VPN access)',
    ipProtocol: 'tcp',
    fromPort: 5432,
    toPort: 5432,
    referencedSecurityGroupId: vpnSecurityGroupId,
  })

  new aws.vpc.SecurityGroupIngressRule(`${name}-db-databricks-peering`, {
    securityGroupId: securityGroup.id,
    description: 'databricks classic compute via vpc peering',
    ipProtocol: 'tcp',
    fromPort: 5432,
    toPort: 5432,
    cidrIpv4: databricksPeeringCidr,
  })

  const subnetGroup = new aws.rds.SubnetGroup(`${name}-subnets`, {
    name: `${name}-subnets`,
    subnetIds: subnets.ids,
  })

  const cluster = new aws.rds.Cluster(
    `${name}-cluster`,
    {
      clusterIdentifier: `${name}-db`,
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      engineVersion,
      databaseName: 'gp_api_poc',
      masterUsername: 'poc_admin',
      manageMasterUserPassword: true,
      dbSubnetGroupName: subnetGroup.name,
      vpcSecurityGroupIds: [securityGroup.id],
      dbClusterParameterGroupName: parameterGroup.name,
      storageEncrypted: true,
      serverlessv2ScalingConfiguration: { minCapacity: 0.5, maxCapacity: 2 },
      enabledCloudwatchLogsExports: ['postgresql'],
      backupRetentionPeriod: 1,
      deletionProtection: false,
      skipFinalSnapshot: true,
      applyImmediately: true,
    },
    { ignoreChanges: ['engineVersion'] },
  )

  const writer = new aws.rds.ClusterInstance(
    `${name}-writer`,
    {
      identifier: `${name}-writer`,
      clusterIdentifier: cluster.id,
      instanceClass: 'db.serverless',
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineVersion: cluster.engineVersion,
      publiclyAccessible: false,
      applyImmediately: true,
    },
    { ignoreChanges: ['engineVersion'] },
  )

  const alarmTopic = new aws.sns.Topic(`${name}-alarms`, {
    name: `${name}-alarms`,
  })

  if (alarmEmail) {
    new aws.sns.TopicSubscription(`${name}-alarms-email`, {
      topic: alarmTopic.arn,
      protocol: 'email',
      endpoint: alarmEmail,
    })
  }

  const alarms = [
    {
      metricName: 'OldestReplicationSlotLag',
      threshold: slotLagAlarmBytes,
      description: 'A replication slot is far behind; WAL is piling up for it',
    },
    {
      metricName: 'ReplicationSlotDiskUsage',
      threshold: walDiskAlarmBytes,
      description: 'Replication slot files are using a lot of disk',
    },
    {
      metricName: 'TransactionLogsDiskUsage',
      threshold: walDiskAlarmBytes,
      description: 'Transaction logs kept for logical replication are growing',
    },
  ].map(
    ({ metricName, threshold, description }) =>
      new aws.cloudwatch.MetricAlarm(`${name}-${metricName}`, {
        name: `${name}-${metricName}`,
        alarmDescription: description,
        namespace: 'AWS/RDS',
        metricName,
        dimensions: { DBInstanceIdentifier: writer.identifier },
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

  const outputs: Record<string, pulumi.Input<unknown>> = {
    vpcCidr: vpc.cidrBlock,
    subnetIds: subnets.ids,
    securityGroupId: securityGroup.id,
    clusterIdentifier: cluster.clusterIdentifier,
    clusterArn: cluster.arn,
    writerEndpoint: cluster.endpoint,
    writerInstanceIdentifier: writer.identifier,
    port: cluster.port,
    databaseName: cluster.databaseName,
    masterUsername: cluster.masterUsername,
    masterSecretArn: cluster.masterUserSecrets.apply(
      (secrets) => secrets[0]?.secretArn,
    ),
    alarmTopicArn: alarmTopic.arn,
    alarmNames: alarms.map((alarm) => alarm.name),
  }

  if (config.getBoolean('enableDms') ?? false) {
    Object.assign(
      outputs,
      createDms({
        config,
        name,
        vpc,
        subnets,
        securityGroup,
        cluster,
        alarmTopic,
      }),
    )
  }

  return outputs
}
