import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { sortBy } from 'es-toolkit'

export interface ServiceConfig {
  environment: 'preview' | 'dev' | 'prod'
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
  // Set on preview stacks once the shared preview ALB exists: the preview
  // then routes through a host-header rule on it instead of its own ALB.
  sharedPreviewListenerArn?: string

  secrets: pulumi.Input<Record<string, pulumi.Input<string>>>
  environmentVariables: pulumi.Input<Record<string, pulumi.Input<string>>>

  permissions: pulumi.Input<
    {
      Effect: 'Allow' | 'Deny'
      Action: string[]
      Resource: pulumi.Input<pulumi.Input<string>[]>
    }[]
  >
  dependsOn: pulumi.ResourceOptions['dependsOn']
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
  sharedPreviewListenerArn,
  secrets,
  environmentVariables,
  permissions,
  dependsOn,
}: ServiceConfig): ServiceOutput {
  const isProd = environment === 'prod'
  const serviceName = `gp-api-${stage}`

  const select = <T>(values: Record<'preview' | 'dev' | 'prod', T>): T =>
    values[environment]

  const clusterName = `gp-${stage}-fargateCluster`
  const cluster = new aws.ecs.Cluster(
    'ecsCluster',
    {
      name: clusterName,
      settings: [{ name: 'containerInsights', value: 'enabled' }],
    },
    { dependsOn },
  )

  const targetGroupArgs: aws.lb.TargetGroupArgs = {
    namePrefix: 'HTTP',
    port: 80,
    protocol: 'HTTP',
    targetType: 'ip',
    vpcId,
    // A preview has no traffic worth draining, and the drain sat on the
    // critical path of every preview deploy.
    deregistrationDelay: select({ preview: 0, dev: 15, prod: 120 }),
    healthCheck: {
      path: '/v1/health',
      // `interval * healthyThreshold` is on the critical path of every deploy:
      // the new task is not "healthy" until that many probes pass. At 60s that
      // alone was two of the five minutes Pulumi waits for the service to
      // stabilize, and preview deploys failed the wait by seconds. Dev trades
      // probe volume for a 30s handover and preview for a 10s one; prod keeps
      // 60s. The ALB requires the timeout to be shorter than the interval.
      interval: select({ preview: 5, dev: 15, prod: 60 }),
      timeout: select({ preview: 4, dev: 5, prod: 5 }),
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      matcher: '200',
    },
  }

  let targetGroup: aws.lb.TargetGroup
  let listenerRule: aws.lb.ListenerRule | undefined
  if (sharedPreviewListenerArn) {
    // A fresh logical name: a stack moving off its own ALB gets a new target
    // group here, since one target group cannot sit behind two load balancers
    // while the old listeners are still being torn down.
    targetGroup = new aws.lb.TargetGroup('previewTargetGroup', targetGroupArgs)
    listenerRule = new aws.lb.ListenerRule('previewListenerRule', {
      listenerArn: sharedPreviewListenerArn,
      // PR numbers are unique, so they double as unique rule priorities.
      priority: Number(stage.replace('pr-', '')),
      conditions: [{ hostHeader: { values: [domain] } }],
      actions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
    })
  } else {
    const albSecurityGroup = new aws.ec2.SecurityGroup('albSecurityGroup', {
      name: select({
        preview: `gp-api-preview-${stage}-sg`,
        dev: 'gp-api-developLoadBalancerSecurityGroup-5ba8676',
        prod: 'gp-api-masterLoadBalancerSecurityGroup-c8b2676',
      }),
      // This is false now, but these names are immutable :sob:
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
        preview: `gpapi-${stage}`,
        dev: 'develop-gpapidevelopLoad',
        prod: 'master-gpapimasterLoadBa',
      }),
      internal: false,
      loadBalancerType: 'application',
      securityGroups: [albSecurityGroup.id],
      subnets: publicSubnetIds,
      enableCrossZoneLoadBalancing: true,
      // 5 minutes — large CSV exports (e.g. constituent contacts proxied from
      // people-api) can stream for several minutes on slow consumer
      // connections. The ALB severs any TCP connection idle longer than this,
      // so we budget room for occasional backpressure stalls without dropping
      // the download. Bytes ordinarily flow continuously.
      idleTimeout: 300,
    })

    targetGroup = new aws.lb.TargetGroup('targetGroup', targetGroupArgs)

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
    // Preview stacks are ephemeral and their per-PR DNS records routinely drift
    // out of Pulumi state (e.g. a stack whose state was cleared while the record
    // lingered in Route53), which makes a redeploy fail with "record already
    // exists". Adopt/overwrite the existing record for preview so a drifted
    // record self-heals; keep the fail-if-exists default for dev/prod.
    const allowOverwrite = environment === 'preview'

    new aws.route53.Record('dnsARecord', {
      zoneId: hostedZoneId,
      name: domain,
      type: 'A',
      allowOverwrite,
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
      allowOverwrite,
      aliases: [
        {
          name: loadBalancer.dnsName,
          zoneId: loadBalancer.zoneId,
          evaluateTargetHealth: true,
        },
      ],
    })
  }

  const logGroup = new aws.cloudwatch.LogGroup('logGroup', {
    name: `/sst/cluster/gp-${stage}-fargateCluster/gp-api-${stage}/gp-api-${stage}`,
    retentionInDays: isProd ? 60 : 30,
  })

  const executionRole = new aws.iam.Role('executionRole', {
    name: `gp-${stage}-gpapi${stage}ExecutionRole-uswest2`,
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
    name: `gp-${stage}-gpapi${stage}TaskRole-uswest2`,
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

  // Preview gets a full vCPU because its boot is on the critical path of every
  // PR: migrations, seed and Nest startup are CPU-bound, and at half a vCPU
  // Nest alone took ~45s to come up. Dev stays at half.
  const cpu = select({ preview: '1024', dev: '512', prod: '1024' })
  const memory = isProd ? '4096' : '2048'

  const taskDefinition = new aws.ecs.TaskDefinition('taskDefinition', {
    family: `gp-${stage}-fargateCluster-gp-api-${stage}`,
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
          secrets: sortBy(Object.entries(sec), [([name]) => name]).map(
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

  new aws.ecs.Service(
    'ecsService',
    {
      name: serviceName,
      cluster: cluster.arn,
      taskDefinition: taskDefinition.arn,
      desiredCount: isProd ? 2 : 1,
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
      // Must exceed the slowest boot, or the faster non-prod probe interval
      // starts failing tasks mid-startup. Preview containers are the slow case:
      // ensure-database, `prisma migrate deploy`, seed, then ~45s of Nest boot.
      healthCheckGracePeriodSeconds: 300,
      deploymentCircuitBreaker: {
        enable: true,
        rollback: false,
      },
      // 100 on dev and prod: a 0 floor lets ECS drain the old task before the
      // new one is healthy, creating a brief no-healthy-target window that
      // flaps the health-probe alert. Preview has no such alert and nobody
      // reads it mid-deploy (the webapp E2E waits on this deploy), so it takes
      // the 0: the old task stops while the new one boots instead of after,
      // which took ~60s off every preview redeploy.
      deploymentMinimumHealthyPercent: select({
        preview: 0,
        dev: 100,
        prod: 100,
      }),
      deploymentMaximumPercent: 200,
      enableExecuteCommand: true,
      // Propagate the task-definition's Project tag onto the running tasks so
      // Fargate compute is attributed in Cost Explorer (tasks don't inherit
      // task-def tags otherwise).
      propagateTags: 'TASK_DEFINITION',
      enableEcsManagedTags: true,
      waitForSteadyState: true,
    },
    // Headroom, not a gate: a real crash-on-boot is caught by the deployment
    // circuit breaker, so the only thing a tight wait buys is a red deploy on a
    // service that stabilizes seconds later.
    {
      customTimeouts: { create: '10m', update: '10m' },
      // ECS rejects a target group that no load balancer forwards to yet.
      dependsOn: listenerRule ? [listenerRule] : [],
    },
  )

  return {
    url: pulumi.interpolate`https://${domain}`,
    logGroupName: logGroup.name,
    logGroupArn: logGroup.arn,
  }
}
