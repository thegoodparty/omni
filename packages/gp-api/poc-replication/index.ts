import { lookup } from 'node:dns/promises'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

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
  const enableFederation = config.getBoolean('enableFederation') ?? false

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
    description: 'Import contacts replication POC: logical replication on',
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
    description: 'Import contacts replication POC Aurora cluster',
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
      databaseName: 'poc_org_layer',
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

  const federation = enableFederation
    ? (() => {
        const region = aws.getRegionOutput().name
        const databricksPrincipal =
          config.get('databricksPrivateConnectivityRoleArn') ??
          pulumi.interpolate`arn:aws:iam::565502421330:role/private-connectivity-role-${region}`

        const nlbSecurityGroup = new aws.ec2.SecurityGroup(`${name}-fed-nlb`, {
          name: `${name}-fed-nlb`,
          description: 'Federation NLB in front of the POC Aurora cluster',
          vpcId: vpc.id,
        })

        new aws.vpc.SecurityGroupEgressRule(`${name}-fed-nlb-to-db`, {
          securityGroupId: nlbSecurityGroup.id,
          description: 'NLB to the POC Aurora cluster',
          ipProtocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          referencedSecurityGroupId: securityGroup.id,
        })

        new aws.vpc.SecurityGroupIngressRule(`${name}-db-federation-nlb`, {
          securityGroupId: securityGroup.id,
          description: 'databricks serverless via privatelink nlb',
          ipProtocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          referencedSecurityGroupId: nlbSecurityGroup.id,
        })

        // NLB targets must be IPs. Resolved once per `pulumi up`; if Aurora
        // moves the instance to a new IP the target goes unhealthy until the
        // next `pulumi up` (README path A, "Aurora IP drift").
        const targetIp = pulumi
          .all([cluster.readerEndpoint, writer.endpoint])
          .apply(async ([readerEndpoint]) => {
            const { address } = await lookup(readerEndpoint, { family: 4 })
            return address
          })

        const nlb = new aws.lb.LoadBalancer(`${name}-fed`, {
          name: 'gp-poc-repl-federation',
          internal: true,
          loadBalancerType: 'network',
          subnets: subnets.ids,
          securityGroups: [nlbSecurityGroup.id],
          enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: 'off',
          enableCrossZoneLoadBalancing: true,
        })

        const targetGroup = new aws.lb.TargetGroup(`${name}-fed`, {
          name: 'gp-poc-repl-federation',
          port: 5432,
          protocol: 'TCP',
          targetType: 'ip',
          vpcId: vpc.id,
          deregistrationDelay: 30,
          healthCheck: { protocol: 'TCP', interval: 10, healthyThreshold: 2 },
        })

        new aws.lb.TargetGroupAttachment(`${name}-fed-aurora`, {
          targetGroupArn: targetGroup.arn,
          targetId: targetIp,
          port: 5432,
        })

        new aws.lb.Listener(`${name}-fed`, {
          loadBalancerArn: nlb.arn,
          port: 5432,
          protocol: 'TCP',
          defaultActions: [
            { type: 'forward', targetGroupArn: targetGroup.arn },
          ],
        })

        const endpointService = new aws.ec2.VpcEndpointService(`${name}-fed`, {
          acceptanceRequired: true,
          networkLoadBalancerArns: [nlb.arn],
          allowedPrincipals: [databricksPrincipal],
          tags: { Name: `${name}-federation` },
        })

        const healthAlarm = new aws.cloudwatch.MetricAlarm(
          `${name}-fed-HealthyHostCount`,
          {
            name: `${name}-fed-HealthyHostCount`,
            alarmDescription:
              'Federation NLB has no healthy Aurora target; federated reads fail',
            namespace: 'AWS/NetworkELB',
            metricName: 'HealthyHostCount',
            dimensions: {
              LoadBalancer: nlb.arnSuffix,
              TargetGroup: targetGroup.arnSuffix,
            },
            statistic: 'Minimum',
            period: 60,
            evaluationPeriods: 2,
            threshold: 1,
            comparisonOperator: 'LessThanThreshold',
            treatMissingData: 'breaching',
            alarmActions: [alarmTopic.arn],
            okActions: [alarmTopic.arn],
          },
        )

        return {
          federationEndpointServiceName: endpointService.serviceName,
          federationEndpointServiceId: endpointService.id,
          federationDomainName: cluster.readerEndpoint,
          federationNlbTargetIp: targetIp,
          federationAllowedPrincipal: databricksPrincipal,
          federationHealthAlarmName: healthAlarm.name,
        }
      })()
    : {}

  return {
    ...federation,
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
}
