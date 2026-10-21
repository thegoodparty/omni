import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { sortBy } from 'lodash'

export interface ServiceConfig {
  environment: 'dev' | 'prod'
  stage: string

  imageUri: string

  vpcId: string
  securityGroupIds: string[]
  // Public subnets host the internet-facing ALB. Fargate tasks run in the
  // private subnets and reach the internet via NAT, so they no longer need
  // public IPs.
  publicSubnetIds: string[]
  privateSubnetIds: string[]

  hostedZoneId: string
  domain: string
  certificateArn: string

  secrets: pulumi.Input<Record<string, pulumi.Input<string>>>
  environmentVariables: pulumi.Input<Record<string, pulumi.Input<string>>>

  permissions: pulumi.Input<
    {
      Effect: 'Allow' | 'Deny'
      Action: string[]
      Resource: pulumi.Input<pulumi.Input<string>[]>
    }[]
  >
}

type ServiceOutput = {
  url: pulumi.Output<string>
  logGroupName: pulumi.Output<string>
  logGroupArn: pulumi.Output<string>
}

export function createService({
  environment,
  stage,
  imageUri,
  vpcId,
  securityGroupIds,
  publicSubnetIds,
  privateSubnetIds,
  hostedZoneId,
  domain,
  certificateArn,
  secrets,
  environmentVariables,
  permissions,
}: ServiceConfig): ServiceOutput {
  const isProd = environment === 'prod'
  const serviceName = `election-api-${stage}`

  const select = <T>(values: Record<'dev' | 'prod', T>): T =>
    values[environment]

  const cluster = new aws.ecs.Cluster('ecsCluster', {
    name: `election-api-${stage}-fargateCluster`,
    settings: [{ name: 'containerInsights', value: 'enabled' }],
  })

  const albSecurityGroup = new aws.ec2.SecurityGroup('albSecurityGroup', {
    name: select({
      dev: 'election-api-developLoadBalancerSecurityGroup-e4893c5',
      prod: 'election-api-masterLoadBalancerSecurityGroup-80ea98d',
    }),
    description: 'Managed by SST',
    vpcId,
    ingress: [
      {
        protocol: 'tcp',
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ['0.0.0.0/0'],
        description: 'HTTP',
      },
      {
        protocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        cidrBlocks: ['0.0.0.0/0'],
        description: 'HTTPS',
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
  })

  const loadBalancer = new aws.lb.LoadBalancer('loadBalancer', {
    name: select({
      dev: 'electionapideve-xrhtdsta',
      prod: 'electionapimast-hhnbxfdh',
    }),
    internal: false,
    loadBalancerType: 'application',
    securityGroups: [albSecurityGroup.id],
    subnets: publicSubnetIds,
    enableCrossZoneLoadBalancing: true,
    idleTimeout: 120,
  })

  const targetGroup = new aws.lb.TargetGroup('targetGroup', {
    name: select({
      dev: 'HTTP20250407183025279100000002',
      prod: 'HTTP20250422010840834800000002',
    }),
    port: 80,
    protocol: 'HTTP',
    targetType: 'ip',
    vpcId,
    deregistrationDelay: 120,
    healthCheck: {
      path: '/v1/health',
      interval: 60,
      timeout: 5,
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      matcher: '200',
    },
  })

  new aws.lb.Listener('httpListener', {
    loadBalancerArn: loadBalancer.arn,
    port: 80,
    protocol: 'HTTP',
    defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
  })

  new aws.lb.Listener('httpsListener', {
    loadBalancerArn: loadBalancer.arn,
    port: 443,
    protocol: 'HTTPS',
    certificateArn,
    sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
    defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
  })

  const logGroup = new aws.cloudwatch.LogGroup('logGroup', {
    name: `/sst/cluster/election-api-${stage}-fargateCluster/election-api-${stage}/election-api-${stage}`,
    retentionInDays: isProd ? 60 : 30,
  })

  const executionRole = new aws.iam.Role('executionRole', {
    name: select({
      dev: 'election-develop-electionapidevelopExecutionRole-badzffuf',
      prod: 'election-master-electionapimasterExecutionRole-rrbnxccf',
    }),
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'ecs-tasks.amazonaws.com',
          },
        },
      ],
    }),
    managedPolicyArns: [
      'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    ],
    inlinePolicies: [
      {
        name: 'inline',
        policy: pulumi.jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'ssm:GetParameters',
                'ssm:GetParameterHistory',
                'ssm:GetParameter',
                'secretsmanager:GetSecretValue',
              ],
              Resource: '*',
            },
          ],
        }),
      },
    ],
  })

  const taskRole = new aws.iam.Role('taskRole', {
    name: select({
      dev: 'election-develop-electionapidevelopTaskRole-mubedrbn',
      prod: 'election-master-electionapimasterTaskRole-odxmbean',
    }),
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'ecs-tasks.amazonaws.com',
          },
        },
      ],
    }),
    inlinePolicies: [
      {
        name: 'inline',
        policy: pulumi.jsonStringify({
          Version: '2012-10-17',
          Statement: permissions,
        }),
      },
    ],
  })

  const cpu = isProd ? '1024' : '512'
  const memory = isProd ? '4096' : '2048'

  const taskDefinition = new aws.ecs.TaskDefinition('taskDefinition', {
    family: `election-api-${stage}-fargateCluster-election-api-${stage}`,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu,
    memory,
    executionRoleArn: executionRole.arn,
    taskRoleArn: taskRole.arn,
    runtimePlatform: {
      cpuArchitecture: 'X86_64',
      operatingSystemFamily: 'LINUX',
    },
    containerDefinitions: pulumi.jsonStringify(
      pulumi.all([environmentVariables, secrets]).apply(([env, sec]) => [
        {
          name: serviceName,
          image: imageUri,
          cpu: parseInt(cpu),
          memory: parseInt(memory),
          essential: true,
          secrets: sortBy(Object.entries(sec), ([name]) => name).map(
            ([name, valueFrom]) => ({
              name,
              valueFrom,
            }),
          ),
          portMappings: [
            {
              containerPort: 80,
              hostPort: 80,
              protocol: 'tcp',
            },
          ],
          environment: sortBy(Object.entries(env), [([name]) => name]).map(
            ([name, value]) => ({
              name,
              value,
            }),
          ),
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': logGroup.name,
              'awslogs-region': 'us-west-2',
              'awslogs-stream-prefix': '/service',
            },
          },
          pseudoTerminal: true,
          linuxParameters: {
            initProcessEnabled: true,
          },
        },
      ]),
    ),
  })

  const minTasks = select({ dev: 1, prod: 6 })

  const ecsService = new aws.ecs.Service(
    'ecsService',
    {
      name: serviceName,
      cluster: cluster.arn,
      taskDefinition: taskDefinition.arn,
      desiredCount: minTasks,
      capacityProviderStrategies: [{ capacityProvider: 'FARGATE', weight: 1 }],
      networkConfiguration: {
        subnets: privateSubnetIds,
        securityGroups: securityGroupIds,
        assignPublicIp: false,
      },
      loadBalancers: [
        {
          targetGroupArn: targetGroup.arn,
          containerName: serviceName,
          containerPort: 80,
        },
      ],
      healthCheckGracePeriodSeconds: 120,
      deploymentCircuitBreaker: {
        enable: true,
        rollback: false,
      },
      enableExecuteCommand: true,
      forceNewDeployment: true,
      // Propagate the task-definition's Project tag onto the running tasks so
      // Fargate compute is attributed in Cost Explorer (tasks don't inherit
      // task-def tags otherwise).
      propagateTags: 'TASK_DEFINITION',
      enableEcsManagedTags: true,
      waitForSteadyState: true,
    },
    // Autoscaling owns the task count. Without this, every deploy resets it
    // to the minimum mid-traffic.
    { ignoreChanges: ['desiredCount'] },
  )

  // Register and Put are upserts, so these adopt the SST-era target and
  // policies by name instead of creating duplicates. The register is only an
  // upsert while it carries no tags — AWS treats a tagged
  // RegisterScalableTarget as create-only and rejects it when the target
  // already exists ("use the TagResource API") — and the stack's
  // aws:defaultTags (deploy.sh) would tag it. A provider without defaultTags
  // keeps the adoption working; this one resource stays untagged.
  const untaggedProvider = new aws.Provider('scalableTargetProvider', {
    region: aws.config.region,
  })
  const scalableTarget = new aws.appautoscaling.Target(
    'scalableTarget',
    {
      serviceNamespace: 'ecs',
      scalableDimension: 'ecs:service:DesiredCount',
      resourceId: pulumi.interpolate`service/${cluster.name}/${ecsService.name}`,
      minCapacity: minTasks,
      maxCapacity: select({ dev: 4, prod: 16 }),
    },
    { provider: untaggedProvider },
  )

  // A scale-in cooldown of 0 removed a task every minute down to the floor,
  // where the remaining tasks saturated and every route returned 500s
  // (ENG-11238).
  const scalingPolicy = (
    name: string,
    policyName: string,
    metricType: string,
  ) =>
    new aws.appautoscaling.Policy(name, {
      name: policyName,
      policyType: 'TargetTrackingScaling',
      serviceNamespace: scalableTarget.serviceNamespace,
      scalableDimension: scalableTarget.scalableDimension,
      resourceId: scalableTarget.resourceId,
      targetTrackingScalingPolicyConfiguration: {
        targetValue: 50,
        predefinedMetricSpecification: { predefinedMetricType: metricType },
        scaleInCooldown: 300,
        scaleOutCooldown: 0,
      },
    })

  scalingPolicy(
    'cpuScalingPolicy',
    select({
      dev: 'election-develop-electionapidevelopAutoScalingCpuPolicy-vxuvwwvb',
      prod: 'election-master-electionapimasterAutoScalingCpuPolicy-vxafbvxu',
    }),
    'ECSServiceAverageCPUUtilization',
  )
  scalingPolicy(
    'memoryScalingPolicy',
    select({
      dev: 'election-develop-electionapidevelopAutoScalingMemoryPolicy-mfmzzawt',
      prod: 'election-master-electionapimasterAutoScalingMemoryPolicy-nadronzr',
    }),
    'ECSServiceAverageMemoryUtilization',
  )

  new aws.route53.Record('dnsARecord', {
    zoneId: hostedZoneId,
    name: domain,
    type: 'A',
    aliases: [
      {
        name: loadBalancer.dnsName,
        zoneId: loadBalancer.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  })
  new aws.route53.Record('dnsAAAARecord', {
    zoneId: hostedZoneId,
    name: domain,
    type: 'AAAA',
    aliases: [
      {
        name: loadBalancer.dnsName,
        zoneId: loadBalancer.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  })

  return {
    url: pulumi.interpolate`https://${domain}`,
    logGroupName: logGroup.name,
    logGroupArn: logGroup.arn,
  }
}
