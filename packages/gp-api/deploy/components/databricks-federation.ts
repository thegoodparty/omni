import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

// Databricks serverless outbound ranges for aws us-west-2 (type "outbound") in
// https://www.databricks.com/networking/v1/ip-ranges.json, read 2026-10-26.
// Every Databricks customer's serverless compute in the region shares them.
const DATABRICKS_SERVERLESS_OUTBOUND_CIDRS = [
  '18.246.106.0/24',
  '3.42.138.0/25',
  '44.234.192.32/28',
  '52.27.216.188/32',
]

const POSTGRES_PORT = 5432

interface DatabricksFederationConfig {
  name: string
  vpcId: string
  publicSubnetIds: string[]
  privateSubnetIds: string[]
  proxySecurityGroup: aws.ec2.SecurityGroup
  rdsSecurityGroupId: pulumi.Input<string>
  clusterIdentifier: pulumi.Input<string>
}

// Lets Databricks serverless compute (which runs federated queries and cannot
// use the workspace's VPC peering) reach the gp-api Aurora cluster: an
// internet-facing NLB that only Databricks' published ranges can reach, in
// front of an RDS Proxy that follows the writer across failovers. Runbook:
// deploy/databricks/federation/README.md.
export const createDatabricksFederation = ({
  name,
  vpcId,
  publicSubnetIds,
  privateSubnetIds,
  proxySecurityGroup,
  rdsSecurityGroupId,
  clusterIdentifier,
}: DatabricksFederationConfig) => {
  const nlbSecurityGroup = new aws.ec2.SecurityGroup(
    'databricksFederationNlbSecurityGroup',
    {
      name: `${name}-nlb`,
      description: 'Databricks federation NLB, open to Databricks serverless',
      vpcId,
    },
  )

  for (const cidr of DATABRICKS_SERVERLESS_OUTBOUND_CIDRS) {
    new aws.vpc.SecurityGroupIngressRule(
      `databricksFederationNlbFrom-${cidr.replace(/[./]/g, '-')}`,
      {
        securityGroupId: nlbSecurityGroup.id,
        description: 'Databricks serverless us-west-2',
        ipProtocol: 'tcp',
        fromPort: POSTGRES_PORT,
        toPort: POSTGRES_PORT,
        cidrIpv4: cidr,
      },
    )
  }

  new aws.vpc.SecurityGroupEgressRule('databricksFederationNlbToProxy', {
    securityGroupId: nlbSecurityGroup.id,
    description: 'federation NLB to its RDS Proxy',
    ipProtocol: 'tcp',
    fromPort: POSTGRES_PORT,
    toPort: POSTGRES_PORT,
    referencedSecurityGroupId: proxySecurityGroup.id,
  })

  new aws.vpc.SecurityGroupIngressRule('databricksFederationProxyFromNlb', {
    securityGroupId: proxySecurityGroup.id,
    description: 'federation NLB',
    ipProtocol: 'tcp',
    fromPort: POSTGRES_PORT,
    toPort: POSTGRES_PORT,
    referencedSecurityGroupId: nlbSecurityGroup.id,
  })

  new aws.vpc.SecurityGroupEgressRule('databricksFederationProxyToRds', {
    securityGroupId: proxySecurityGroup.id,
    description: 'federation RDS Proxy to the gp-api Aurora cluster',
    ipProtocol: 'tcp',
    fromPort: POSTGRES_PORT,
    toPort: POSTGRES_PORT,
    referencedSecurityGroupId: rdsSecurityGroupId,
  })

  // Created without a value so the password never enters Pulumi state. The DB
  // admin writes {"username":"databricks_federation","password":"..."} (README
  // step 3).
  const proxySecret = new aws.secretsmanager.Secret(
    'databricksFederationProxySecret',
    {
      name: `${name}-proxy`,
      description: 'databricks_federation credentials for the RDS Proxy',
    },
  )

  const proxyRole = new aws.iam.Role('databricksFederationProxyRole', {
    name: `${name}-proxy`,
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'rds.amazonaws.com',
    }),
  })

  // Per https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-iam-setup.html,
  // including kms:Decrypt for the secret's key (here the default
  // aws/secretsmanager key), limited to decrypting this one secret.
  const proxyRolePolicy = new aws.iam.RolePolicy(
    'databricksFederationProxyPolicy',
    {
      role: proxyRole.id,
      policy: pulumi.jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'secretsmanager:GetSecretValue',
            Resource: proxySecret.arn,
          },
          {
            Effect: 'Allow',
            Action: 'kms:Decrypt',
            Resource: '*',
            Condition: {
              StringEquals: {
                'kms:ViaService': 'secretsmanager.us-west-2.amazonaws.com',
                'kms:EncryptionContext:SecretARN': proxySecret.arn,
              },
            },
          },
        ],
      }),
    },
  )

  const proxy = new aws.rds.Proxy(
    'databricksFederationProxy',
    {
      name,
      engineFamily: 'POSTGRESQL',
      roleArn: proxyRole.arn,
      vpcSubnetIds: privateSubnetIds,
      vpcSecurityGroupIds: [proxySecurityGroup.id],
      requireTls: true,
      debugLogging: false,
      auths: [
        {
          authScheme: 'SECRETS',
          secretArn: proxySecret.arn,
          iamAuth: 'DISABLED',
          description: 'databricks_federation',
        },
      ],
    },
    { dependsOn: [proxyRolePolicy] },
  )

  const proxyTargetGroup = new aws.rds.ProxyDefaultTargetGroup(
    'databricksFederationProxyTargetGroup',
    {
      dbProxyName: proxy.name,
      connectionPoolConfig: {
        // A percent of Aurora's max_connections. Low so federated scans can
        // never crowd out gp-api; the role's own limit of 20 binds first.
        maxConnectionsPercent: 10,
        // The provider sends 50 when unset, and AWS rejects an idle percent
        // above maxConnectionsPercent.
        maxIdleConnectionsPercent: 5,
      },
    },
  )

  new aws.rds.ProxyTarget('databricksFederationProxyTarget', {
    dbProxyName: proxy.name,
    targetGroupName: proxyTargetGroup.name,
    dbClusterIdentifier: clusterIdentifier,
  })

  const nlb = new aws.lb.LoadBalancer('databricksFederationNlb', {
    name,
    internal: false,
    loadBalancerType: 'network',
    subnets: publicSubnetIds,
    securityGroups: [nlbSecurityGroup.id],
  })

  const nlbTargetGroup = new aws.lb.TargetGroup('databricksFederationTargets', {
    name,
    port: POSTGRES_PORT,
    protocol: 'TCP',
    targetType: 'ip',
    vpcId,
    // The proxy then sees the NLB's address, which its security group
    // allows, rather than a Databricks one.
    preserveClientIp: 'false',
    deregistrationDelay: 30,
    healthCheck: { protocol: 'TCP', interval: 10, healthyThreshold: 2 },
  })

  new aws.lb.Listener('databricksFederationListener', {
    loadBalancerArn: nlb.arn,
    port: POSTGRES_PORT,
    protocol: 'TCP',
    defaultActions: [{ type: 'forward', targetGroupArn: nlbTargetGroup.arn }],
  })

  // The proxy's default endpoint is a VPC endpoint with one network interface
  // in each of its subnets, carrying the proxy's security group, and its IPs
  // are "static IP addresses for the life of the endpoint":
  // https://aws.amazon.com/blogs/database/use-amazon-rds-proxy-and-aws-privatelink-to-access-amazon-rds-databases-across-aws-organizations-at-american-family-insurance-group/
  // Keyed on the proxy so the lookup runs only once the proxy exists.
  const proxySecurityGroupIdOnceCreated = pulumi
    .all([proxy.arn, proxySecurityGroup.id])
    .apply(([, securityGroupId]) => securityGroupId)

  privateSubnetIds.forEach((subnetId, index) => {
    const proxyEndpointInterface = aws.ec2.getNetworkInterfaceOutput({
      filters: [
        { name: 'group-id', values: [proxySecurityGroupIdOnceCreated] },
        { name: 'interface-type', values: ['vpc_endpoint'] },
        { name: 'subnet-id', values: [subnetId] },
      ],
    })

    new aws.lb.TargetGroupAttachment(
      `databricksFederationProxyEndpoint${index}`,
      {
        targetGroupArn: nlbTargetGroup.arn,
        targetId: proxyEndpointInterface.privateIp,
        port: POSTGRES_PORT,
      },
    )
  })

  return { nlb }
}
