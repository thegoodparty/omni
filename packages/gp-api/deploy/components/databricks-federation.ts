import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import * as ts from 'typescript'

// The Databricks serverless stable IAM role for us-west-2, from "Create a VPC
// endpoint service in your AWS account" in
// https://docs.databricks.com/aws/en/security/network/serverless-network-security/pl-to-internal-network
// (format arn:aws:iam::565502421330:role/private-connectivity-role-<region>).
const DATABRICKS_SERVERLESS_PRINCIPAL =
  'arn:aws:iam::565502421330:role/private-connectivity-role-us-west-2'

const POSTGRES_PORT = 5432

interface DatabricksFederationConfig {
  name: string
  vpcId: string
  privateSubnetIds: string[]
  nlbSecurityGroup: aws.ec2.SecurityGroup
  rdsSecurityGroupId: pulumi.Input<string>
  clusterEndpoint: pulumi.Input<string>
}

// Lets Databricks serverless compute (which runs federated queries and cannot
// use the workspace's VPC peering) reach the gp-api Aurora writer over
// PrivateLink: an internal NLB in front of the writer, exposed as a VPC
// endpoint service that a private endpoint rule on the workspace's NCC
// connects to. Runbook: deploy/databricks/federation/README.md.
export const createDatabricksFederation = ({
  name,
  vpcId,
  privateSubnetIds,
  nlbSecurityGroup,
  rdsSecurityGroupId,
  clusterEndpoint,
}: DatabricksFederationConfig) => {
  new aws.vpc.SecurityGroupEgressRule('databricksFederationNlbToRds', {
    securityGroupId: nlbSecurityGroup.id,
    description: 'federation NLB to the gp-api Aurora cluster',
    ipProtocol: 'tcp',
    fromPort: POSTGRES_PORT,
    toPort: POSTGRES_PORT,
    referencedSecurityGroupId: rdsSecurityGroupId,
  })

  const nlb = new aws.lb.LoadBalancer('databricksFederationNlb', {
    name,
    internal: true,
    loadBalancerType: 'network',
    subnets: privateSubnetIds,
    securityGroups: [nlbSecurityGroup.id],
    // Required off by the Databricks page cited above.
    enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: 'off',
    // The Databricks endpoint can land in either AZ; the writer is in one.
    enableCrossZoneLoadBalancing: true,
  })

  // Targets are registered only by the IP-sync Lambda below, never by Pulumi,
  // so a deploy cannot put back an IP the writer has since moved off.
  const targetGroup = new aws.lb.TargetGroup('databricksFederationTargets', {
    name,
    port: POSTGRES_PORT,
    protocol: 'TCP',
    targetType: 'ip',
    vpcId,
    deregistrationDelay: 30,
    healthCheck: { protocol: 'TCP', interval: 10, healthyThreshold: 2 },
  })

  new aws.lb.Listener('databricksFederationListener', {
    loadBalancerArn: nlb.arn,
    port: POSTGRES_PORT,
    protocol: 'TCP',
    defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
  })

  const endpointService = new aws.ec2.VpcEndpointService(
    'databricksFederationEndpointService',
    {
      acceptanceRequired: false,
      networkLoadBalancerArns: [nlb.arn],
      allowedPrincipals: [DATABRICKS_SERVERLESS_PRINCIPAL],
      tags: { Name: name },
    },
  )

  // Aurora moves the writer's IP on failover and host replacement, and an NLB
  // target can only be an IP, so this re-points the target group every
  // minute. It runs outside the VPC: the cluster endpoint resolves publicly to
  // the writer's private IP, and the ELB API is public.
  const ipSyncName = `${name}-ip-sync`

  const ipSyncLogGroup = new aws.cloudwatch.LogGroup(
    'databricksFederationIpSyncLogs',
    { name: `/aws/lambda/${ipSyncName}`, retentionInDays: 30 },
  )

  const ipSyncRole = new aws.iam.Role('databricksFederationIpSyncRole', {
    name: ipSyncName,
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'lambda.amazonaws.com',
    }),
  })

  new aws.iam.RolePolicy('databricksFederationIpSyncPolicy', {
    role: ipSyncRole.id,
    policy: pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          // ELB Describe actions do not support resource-level permissions.
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
          Resource: targetGroup.arn,
        },
        {
          Effect: 'Allow',
          Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          Resource: pulumi.interpolate`${ipSyncLogGroup.arn}:*`,
        },
      ],
    }),
  })

  const targetPlanSource = ts.transpileModule(
    readFileSync(
      join(__dirname, 'databricks-federation-ip-sync/target-plan.ts'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText

  const ipSync = new aws.lambda.Function(
    'databricksFederationIpSync',
    {
      name: ipSyncName,
      description:
        'Points the Databricks federation NLB at the Aurora writer IP',
      runtime: aws.lambda.Runtime.NodeJS22dX,
      handler: 'handler.handler',
      role: ipSyncRole.arn,
      timeout: 30,
      memorySize: 128,
      code: new pulumi.asset.AssetArchive({
        'handler.mjs': new pulumi.asset.FileAsset(
          join(__dirname, 'databricks-federation-ip-sync/handler.mjs'),
        ),
        'target-plan.mjs': new pulumi.asset.StringAsset(targetPlanSource),
      }),
      environment: {
        variables: {
          DB_HOSTNAME: clusterEndpoint,
          DB_PORT: String(POSTGRES_PORT),
          TARGET_GROUP_ARN: targetGroup.arn,
        },
      },
    },
    { dependsOn: [ipSyncLogGroup] },
  )

  const ipSyncSchedule = new aws.cloudwatch.EventRule(
    'databricksFederationIpSyncSchedule',
    {
      name: ipSyncName,
      description: `Runs ${ipSyncName} every minute`,
      scheduleExpression: 'rate(1 minute)',
    },
  )

  new aws.cloudwatch.EventTarget('databricksFederationIpSyncTarget', {
    rule: ipSyncSchedule.name,
    arn: ipSync.arn,
  })

  new aws.lambda.Permission('databricksFederationIpSyncInvoke', {
    action: 'lambda:InvokeFunction',
    function: ipSync.name,
    principal: 'events.amazonaws.com',
    sourceArn: ipSyncSchedule.arn,
  })

  return { endpointService }
}
