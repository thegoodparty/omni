import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

export const federationIpSyncSource = `import { resolve4 } from 'node:dns/promises'
import {
  DeregisterTargetsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2'

const client = new ElasticLoadBalancingV2Client({})

export const handler = async (event) => {
  const TargetGroupArn = process.env.TARGET_GROUP_ARN
  const Port = Number(process.env.TARGET_PORT)
  const wanted = [...new Set(await resolve4(process.env.DOMAIN_NAME))].sort()
  if (wanted.length === 0) throw new Error('reader endpoint resolved to no addresses')
  const { TargetHealthDescriptions = [] } = await client.send(
    new DescribeTargetHealthCommand({ TargetGroupArn }),
  )
  const registered = TargetHealthDescriptions.map((d) => d.Target.Id).sort()
  const added = wanted.filter((ip) => !registered.includes(ip))
  const removed = registered.filter((ip) => !wanted.includes(ip))
  if (added.length > 0) {
    await client.send(
      new RegisterTargetsCommand({
        TargetGroupArn,
        Targets: added.map((Id) => ({ Id, Port })),
      }),
    )
  }
  if (removed.length > 0) {
    await client.send(
      new DeregisterTargetsCommand({
        TargetGroupArn,
        Targets: removed.map((Id) => ({ Id, Port })),
      }),
    )
  }
  const result = {
    trigger: event?.source ?? event?.trigger ?? 'manual',
    wanted,
    registered,
    added,
    removed,
  }
  console.log(JSON.stringify(result))
  return result
}
`

export const createFederation = ({
  name,
  config,
  vpc,
  subnets,
  securityGroup,
  cluster,
  writer,
  alarmTopic,
}: {
  name: string
  config: pulumi.Config
  vpc: pulumi.Output<aws.ec2.GetVpcResult>
  subnets: pulumi.Output<aws.ec2.GetSubnetsResult>
  securityGroup: aws.ec2.SecurityGroup
  cluster: aws.rds.Cluster
  writer: aws.rds.ClusterInstance
  alarmTopic: aws.sns.Topic
}): Record<string, pulumi.Input<unknown>> => {
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

  const nlb = new aws.lb.LoadBalancer(`${name}-fed`, {
    name: 'gp-poc-repl-federation',
    internal: true,
    loadBalancerType: 'network',
    subnets: subnets.ids,
    securityGroups: [nlbSecurityGroup.id],
    enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: 'off',
    enableCrossZoneLoadBalancing: true,
  })

  // Targets are registered only by the IP-sync Lambda below, never by Pulumi,
  // so a `pulumi up` can't put back an IP Aurora has since moved off.
  const targetGroup = new aws.lb.TargetGroup(`${name}-fed`, {
    name: 'gp-poc-repl-federation',
    port: 5432,
    protocol: 'TCP',
    targetType: 'ip',
    vpcId: vpc.id,
    deregistrationDelay: 30,
    healthCheck: { protocol: 'TCP', interval: 10, healthyThreshold: 2 },
  })

  new aws.lb.Listener(`${name}-fed`, {
    loadBalancerArn: nlb.arn,
    port: 5432,
    protocol: 'TCP',
    defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
  })

  const endpointService = new aws.ec2.VpcEndpointService(`${name}-fed`, {
    acceptanceRequired: true,
    networkLoadBalancerArns: [nlb.arn],
    allowedPrincipals: [databricksPrincipal],
    tags: { Name: `${name}-federation` },
  })

  const ipSyncName = `${name}-fed-ip-sync`

  const ipSyncRole = new aws.iam.Role(ipSyncName, {
    name: ipSyncName,
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'lambda.amazonaws.com',
    }),
  })

  new aws.iam.RolePolicyAttachment(`${ipSyncName}-logs`, {
    role: ipSyncRole.name,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
  })

  new aws.iam.RolePolicy(`${ipSyncName}-targets`, {
    role: ipSyncRole.id,
    policy: targetGroup.arn.apply((targetGroupArn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'elasticloadbalancing:DescribeTargetHealth',
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: [
              'elasticloadbalancing:RegisterTargets',
              'elasticloadbalancing:DeregisterTargets',
            ],
            Resource: targetGroupArn,
          },
        ],
      }),
    ),
  })

  const ipSyncLogGroup = new aws.cloudwatch.LogGroup(ipSyncName, {
    name: `/aws/lambda/${ipSyncName}`,
    retentionInDays: 7,
  })

  const ipSync = new aws.lambda.Function(
    ipSyncName,
    {
      name: ipSyncName,
      description:
        'Points the federation NLB target group at the IPs the POC reader endpoint resolves to',
      runtime: aws.lambda.Runtime.NodeJS22dX,
      handler: 'index.handler',
      role: ipSyncRole.arn,
      timeout: 30,
      memorySize: 128,
      code: new pulumi.asset.AssetArchive({
        'index.mjs': new pulumi.asset.StringAsset(federationIpSyncSource),
      }),
      environment: {
        variables: {
          DOMAIN_NAME: cluster.readerEndpoint,
          TARGET_GROUP_ARN: targetGroup.arn,
          TARGET_PORT: '5432',
        },
      },
    },
    { dependsOn: [ipSyncLogGroup] },
  )

  const triggers = [
    {
      key: 'schedule',
      args: { scheduleExpression: 'rate(1 minute)' },
    },
    {
      key: 'rds-events',
      args: {
        eventPattern: pulumi
          .all([cluster.arn, writer.arn])
          .apply(([clusterArn, writerArn]) =>
            JSON.stringify({
              source: ['aws.rds'],
              'detail-type': ['RDS DB Instance Event', 'RDS DB Cluster Event'],
              resources: [clusterArn, writerArn],
            }),
          ),
      },
    },
  ]

  for (const { key, args } of triggers) {
    const rule = new aws.cloudwatch.EventRule(`${ipSyncName}-${key}`, {
      name: `${ipSyncName}-${key}`,
      description: `Runs ${ipSyncName} (${key})`,
      ...args,
    })
    new aws.cloudwatch.EventTarget(`${ipSyncName}-${key}`, {
      rule: rule.name,
      arn: ipSync.arn,
    })
    new aws.lambda.Permission(`${ipSyncName}-${key}`, {
      action: 'lambda:InvokeFunction',
      function: ipSync.name,
      principal: 'events.amazonaws.com',
      sourceArn: rule.arn,
    })
  }

  const firstSync = new aws.lambda.Invocation(`${ipSyncName}-first`, {
    functionName: ipSync.name,
    input: JSON.stringify({ trigger: 'pulumi' }),
    triggers: {
      domainName: cluster.readerEndpoint,
      targetGroupArn: targetGroup.arn,
      writer: writer.identifier,
    },
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

  const ipSyncAlarm = new aws.cloudwatch.MetricAlarm(
    `${name}-fed-ip-sync-Errors`,
    {
      name: `${name}-fed-ip-sync-Errors`,
      alarmDescription:
        'The federation IP-sync Lambda is failing; the NLB target will go stale on the next Aurora IP change',
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensions: { FunctionName: ipSync.name },
      statistic: 'Sum',
      period: 300,
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: 'GreaterThanThreshold',
      treatMissingData: 'notBreaching',
      alarmActions: [alarmTopic.arn],
      okActions: [alarmTopic.arn],
    },
  )

  return {
    federationEndpointServiceName: endpointService.serviceName,
    federationEndpointServiceId: endpointService.id,
    federationDomainName: cluster.readerEndpoint,
    federationAllowedPrincipal: databricksPrincipal,
    federationTargetGroupArn: targetGroup.arn,
    federationIpSyncFunctionName: ipSync.name,
    federationFirstSyncResult: firstSync.result,
    federationHealthAlarmName: healthAlarm.name,
    federationIpSyncAlarmName: ipSyncAlarm.name,
  }
}
