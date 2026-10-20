import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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
  const enableDms = config.getBoolean('enableDms') ?? false

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

  let dmsOutputs: Record<string, pulumi.Input<unknown>> = {}
  if (enableDms) {
    const lambdaDist = join(__dirname, 'lambda', 'dms-zerobus', 'dist')
    if (!existsSync(join(lambdaDist, 'consumer', 'index.js'))) {
      throw new Error(
        'enableDms needs the Lambda bundles: run lambda/dms-zerobus/build.sh first',
      )
    }
    const dmsName = `${name}-dms`
    const metricsNamespace = 'GpPocReplication/Dms'
    const metricsPipeline = 'dms-zerobus'
    const canarySource = 'canary'
    const region = aws.getRegionOutput().name

    const stream = new aws.kinesis.Stream(dmsName, {
      name: dmsName,
      streamModeDetails: { streamMode: 'ON_DEMAND' },
      retentionPeriod: 24,
    })

    const dmsSecurityGroup = new aws.ec2.SecurityGroup(`${dmsName}-sg`, {
      name: `${dmsName}-sg`,
      description:
        'Import contacts replication POC: DMS Serverless replication',
      vpcId: vpc.id,
    })
    new aws.vpc.SecurityGroupEgressRule(`${dmsName}-sg-egress`, {
      securityGroupId: dmsSecurityGroup.id,
      ipProtocol: '-1',
      cidrIpv4: '0.0.0.0/0',
    })
    new aws.vpc.SecurityGroupIngressRule(`${name}-db-dms`, {
      securityGroupId: securityGroup.id,
      description: 'dms serverless replication (path C)',
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      referencedSecurityGroupId: dmsSecurityGroup.id,
    })

    // DMS 3.4.7+ in a private subnet only reaches Kinesis through an interface
    // endpoint. Private DNS makes it VPC-wide, so it admits 443 from the whole
    // VPC; set dmsCreateKinesisVpcEndpoint=false if the VPC already has one.
    if (config.getBoolean('dmsCreateKinesisVpcEndpoint') ?? true) {
      const endpointSecurityGroup = new aws.ec2.SecurityGroup(
        `${dmsName}-kinesis-endpoint`,
        {
          name: `${dmsName}-kinesis-endpoint`,
          description: 'Import contacts replication POC: Kinesis VPC endpoint',
          vpcId: vpc.id,
        },
      )
      new aws.vpc.SecurityGroupIngressRule(
        `${dmsName}-kinesis-endpoint-https`,
        {
          securityGroupId: endpointSecurityGroup.id,
          description: 'https from the vpc',
          ipProtocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          cidrIpv4: vpc.cidrBlock,
        },
      )
      new aws.ec2.VpcEndpoint(`${dmsName}-kinesis`, {
        vpcId: vpc.id,
        serviceName: pulumi.interpolate`com.amazonaws.${region}.kinesis-streams`,
        vpcEndpointType: 'Interface',
        privateDnsEnabled: true,
        subnetIds: subnets.ids,
        securityGroupIds: [endpointSecurityGroup.id],
        tags: { Name: `${dmsName}-kinesis` },
      })
    }

    const dmsServiceRoles: aws.iam.Role[] = []
    if (config.getBoolean('dmsCreateServiceRoles') ?? false) {
      for (const [roleName, policyArn] of [
        [
          'dms-vpc-role',
          'arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole',
        ],
        [
          'dms-cloudwatch-logs-role',
          'arn:aws:iam::aws:policy/service-role/AmazonDMSCloudWatchLogsRole',
        ],
      ]) {
        const role = new aws.iam.Role(roleName, {
          name: roleName,
          assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: 'dms.amazonaws.com',
          }),
        })
        new aws.iam.RolePolicyAttachment(roleName, {
          role: role.name,
          policyArn,
        })
        dmsServiceRoles.push(role)
      }
    }

    const dmsKinesisRole = new aws.iam.Role(`${dmsName}-kinesis`, {
      name: `${dmsName}-kinesis`,
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'dms.amazonaws.com',
      }),
    })
    new aws.iam.RolePolicy(`${dmsName}-kinesis`, {
      name: `${dmsName}-kinesis-put`,
      role: dmsKinesisRole.id,
      policy: stream.arn.apply((streamArn) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'kinesis:DescribeStream',
                'kinesis:PutRecord',
                'kinesis:PutRecords',
              ],
              Resource: streamArn,
            },
          ],
        }),
      ),
    })

    const dmsSubnetGroup = new aws.dms.ReplicationSubnetGroup(
      dmsName,
      {
        replicationSubnetGroupId: dmsName,
        replicationSubnetGroupDescription: 'Import contacts replication POC',
        subnetIds: subnets.ids,
      },
      { dependsOn: dmsServiceRoles },
    )

    const sourceEndpoint = new aws.dms.Endpoint(`${dmsName}-source`, {
      endpointId: `${dmsName}-source`,
      endpointType: 'source',
      engineName: 'aurora-postgresql',
      serverName: cluster.endpoint,
      port: 5432,
      databaseName: 'poc_org_layer',
      username: config.get('dmsSourceUsername') ?? 'dms_repl',
      password: config.requireSecret('dmsSourcePassword'),
      sslMode: 'require',
      postgresSettings: {
        pluginName: 'test_decoding',
        heartbeatEnable: true,
        heartbeatFrequency: 1,
        captureDdls: true,
        ddlArtifactsSchema: 'public',
        failTasksOnLobTruncation: true,
      },
    })

    const targetEndpoint = new aws.dms.Endpoint(`${dmsName}-kinesis-target`, {
      endpointId: `${dmsName}-kinesis`,
      endpointType: 'target',
      engineName: 'kinesis',
      kinesisSettings: {
        streamArn: stream.arn,
        serviceAccessRoleArn: dmsKinesisRole.arn,
        messageFormat: 'json',
        includeNullAndEmpty: true,
        includeControlDetails: true,
        includeTableAlterOperations: true,
        includeTransactionDetails: true,
      },
    })

    const replication = new aws.dms.ReplicationConfig(dmsName, {
      replicationConfigIdentifier: dmsName,
      resourceIdentifier: dmsName,
      replicationType: 'full-load-and-cdc',
      sourceEndpointArn: sourceEndpoint.endpointArn,
      targetEndpointArn: targetEndpoint.endpointArn,
      startReplication: config.getBoolean('dmsStartReplication') ?? false,
      computeConfig: {
        replicationSubnetGroupId: dmsSubnetGroup.replicationSubnetGroupId,
        vpcSecurityGroupIds: [dmsSecurityGroup.id],
        minCapacityUnits: 1,
        maxCapacityUnits: config.getNumber('dmsMaxCapacityUnits') ?? 2,
        multiAz: false,
      },
      tableMappings: JSON.stringify({
        rules: [
          {
            'rule-type': 'selection',
            'rule-id': '1',
            'rule-name': 'org-contact-event-only',
            'object-locator': {
              'schema-name': 'public',
              'table-name': 'org_contact_event',
            },
            'rule-action': 'include',
          },
        ],
      }),
      // Kinesis targets have no full LOB mode and reject batch apply. TEXT
      // columns are NCLOBs to DMS, so limited LOB mode must be on or they
      // are dropped; failTasksOnLobTruncation fails the task rather than
      // truncate a value over LobMaxSize (KB).
      replicationSettings: JSON.stringify({
        TargetMetadata: {
          SupportLobs: true,
          FullLobMode: false,
          LimitedSizeLobMode: true,
          LobMaxSize: 64,
          BatchApplyEnabled: false,
        },
        FullLoadSettings: { TargetTablePrepMode: 'DO_NOTHING' },
        Logging: { EnableLogging: true },
      }),
    })

    const zerobusSecret = new aws.secretsmanager.Secret(`${name}-zerobus-sp`, {
      name: `${name}-zerobus-sp`,
      description:
        'Databricks service principal for Zerobus (JSON: client_id, client_secret). Value set by hand.',
      recoveryWindowInDays: 0,
    })

    const consumerName = `${dmsName}-consumer`
    const consumerLogs = new aws.cloudwatch.LogGroup(consumerName, {
      name: `/aws/lambda/${consumerName}`,
      retentionInDays: 14,
    })
    const consumerRole = new aws.iam.Role(consumerName, {
      name: consumerName,
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'lambda.amazonaws.com',
      }),
    })
    new aws.iam.RolePolicyAttachment(consumerName, {
      role: consumerRole.name,
      policyArn:
        'arn:aws:iam::aws:policy/service-role/AWSLambdaKinesisExecutionRole',
    })
    new aws.iam.RolePolicy(`${consumerName}-secret`, {
      role: consumerRole.id,
      policy: zerobusSecret.arn.apply((secretArn) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'secretsmanager:GetSecretValue',
              Resource: secretArn,
            },
          ],
        }),
      ),
    })
    const consumer = new aws.lambda.Function(
      consumerName,
      {
        name: consumerName,
        role: consumerRole.arn,
        runtime: aws.lambda.Runtime.NodeJS22dX,
        architectures: ['x86_64'],
        handler: 'index.handler',
        code: new pulumi.asset.FileArchive(join(lambdaDist, 'consumer')),
        memorySize: 512,
        timeout: 60,
        environment: {
          variables: {
            ZEROBUS_SERVER_ENDPOINT:
              config.get('zerobusEndpoint') ??
              'https://3578414625112071.zerobus.us-west-2.cloud.databricks.com',
            DATABRICKS_WORKSPACE_URL:
              config.get('databricksWorkspaceUrl') ??
              'https://dbc-3d8ca484-79f3.cloud.databricks.com',
            ZEROBUS_TABLE_NAME:
              config.get('zerobusTableName') ??
              'goodparty_data_catalog.poc_import_contacts_dms.org_contact_event',
            ZEROBUS_SECRET_ARN: zerobusSecret.arn,
            SOURCE_SCHEMA: 'public',
            SOURCE_TABLE: 'org_contact_event',
            CANARY_SOURCE: canarySource,
            METRICS_NAMESPACE: metricsNamespace,
            METRICS_PIPELINE: metricsPipeline,
          },
        },
      },
      { dependsOn: [consumerLogs] },
    )
    new aws.lambda.EventSourceMapping(consumerName, {
      functionName: consumer.arn,
      eventSourceArn: stream.arn,
      startingPosition: 'TRIM_HORIZON',
      batchSize: 100,
      maximumBatchingWindowInSeconds: 1,
      parallelizationFactor: 1,
    })

    const canaryName = `${dmsName}-canary`
    const canaryOrgSlug = 'poc-dms-canary'
    const canaryLogs = new aws.cloudwatch.LogGroup(canaryName, {
      name: `/aws/lambda/${canaryName}`,
      retentionInDays: 14,
    })
    const canarySecurityGroup = new aws.ec2.SecurityGroup(canaryName, {
      name: canaryName,
      description: 'Import contacts replication POC: path C canary Lambda',
      vpcId: vpc.id,
    })
    new aws.vpc.SecurityGroupEgressRule(`${canaryName}-egress`, {
      securityGroupId: canarySecurityGroup.id,
      ipProtocol: '-1',
      cidrIpv4: '0.0.0.0/0',
    })
    new aws.vpc.SecurityGroupIngressRule(`${name}-db-dms-canary`, {
      securityGroupId: securityGroup.id,
      description: 'path C canary lambda',
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      referencedSecurityGroupId: canarySecurityGroup.id,
    })
    const canaryRole = new aws.iam.Role(canaryName, {
      name: canaryName,
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'lambda.amazonaws.com',
      }),
    })
    new aws.iam.RolePolicyAttachment(canaryName, {
      role: canaryRole.name,
      policyArn:
        'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
    })
    const masterSecretArn = cluster.masterUserSecrets.apply(
      (secrets) => secrets[0]?.secretArn ?? '',
    )
    new aws.iam.RolePolicy(`${canaryName}-secret`, {
      role: canaryRole.id,
      policy: masterSecretArn.apply((secretArn) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'secretsmanager:GetSecretValue',
              Resource: secretArn,
            },
          ],
        }),
      ),
    })
    const canary = new aws.lambda.Function(
      canaryName,
      {
        name: canaryName,
        role: canaryRole.arn,
        runtime: aws.lambda.Runtime.NodeJS22dX,
        architectures: ['x86_64'],
        handler: 'index.handler',
        code: new pulumi.asset.FileArchive(join(lambdaDist, 'canary')),
        memorySize: 256,
        timeout: 30,
        vpcConfig: {
          subnetIds: subnets.ids,
          securityGroupIds: [canarySecurityGroup.id],
        },
        environment: {
          variables: {
            NODE_EXTRA_CA_CERTS: '/var/runtime/ca-cert.pem',
            DB_HOST: cluster.endpoint,
            DB_NAME: 'poc_org_layer',
            DB_SECRET_ARN: masterSecretArn,
            CANARY_ORG_SLUG: canaryOrgSlug,
            CANARY_SOURCE: canarySource,
          },
        },
      },
      { dependsOn: [canaryLogs] },
    )
    const canarySchedule = new aws.cloudwatch.EventRule(canaryName, {
      name: canaryName,
      description: 'Path C canary: one change-log row a minute',
      scheduleExpression: 'rate(1 minute)',
      state:
        config.getBoolean('dmsCanaryEnabled') === false
          ? 'DISABLED'
          : 'ENABLED',
    })
    new aws.lambda.Permission(canaryName, {
      action: 'lambda:InvokeFunction',
      function: canary.name,
      principal: 'events.amazonaws.com',
      sourceArn: canarySchedule.arn,
    })
    new aws.cloudwatch.EventTarget(canaryName, {
      rule: canarySchedule.name,
      arn: canary.arn,
    })

    // Serverless replications publish AWS/DMS metrics under one
    // ReplicationConfigId dimension, "<account>:<resource id>" from the ARN.
    // Not in the AWS docs; taken from a working Terraform setup (README).
    const replicationConfigId = replication.arn.apply((arn) => {
      const parts = arn.split(':')
      return `${parts[4]}:${parts[6]}`
    })
    const pipelineDimensions = { Pipeline: metricsPipeline }
    const dmsAlarmSpecs: Array<
      { alarm: string; description: string } & aws.cloudwatch.MetricAlarmArgs
    > = [
      {
        alarm: 'canary-missing',
        description:
          'No canary row reached Zerobus in 10 minutes: DMS stalled (RUNNING but idle, failed, slot lost), Kinesis, the consumer or Zerobus is down',
        namespace: metricsNamespace,
        metricName: 'CanaryEventsDelivered',
        dimensions: pipelineDimensions,
        statistic: 'Sum',
        threshold: 1,
        comparisonOperator: 'LessThanThreshold',
        evaluationPeriods: 2,
        treatMissingData: 'breaching',
      },
      {
        alarm: 'canary-lag',
        description:
          'A canary row took over 30 s from Postgres commit to Zerobus ack',
        namespace: metricsNamespace,
        metricName: 'CanaryLagMs',
        dimensions: pipelineDimensions,
        statistic: 'Maximum',
        threshold: 30_000,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'notBreaching',
      },
      {
        alarm: 'ignored-changes',
        description:
          'DMS delivered an update, delete or truncate on the append-only log. Updates are where unchanged TOAST values arrive as null; the consumer drops them',
        namespace: metricsNamespace,
        metricName: 'IgnoredChanges',
        dimensions: pipelineDimensions,
        statistic: 'Sum',
        threshold: 0,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'notBreaching',
      },
      {
        alarm: 'ddl',
        description:
          'DDL on org_contact_event reached the stream. Zerobus never evolves the target, so a new column must be added to the Delta table first',
        namespace: metricsNamespace,
        metricName: 'DdlRecords',
        dimensions: pipelineDimensions,
        statistic: 'Sum',
        threshold: 0,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'notBreaching',
      },
      {
        alarm: 'malformed-records',
        description:
          'The consumer skipped DMS records it could not map (missing NOT NULL column, bad timestamp, not JSON)',
        namespace: metricsNamespace,
        metricName: 'MalformedRecords',
        dimensions: pipelineDimensions,
        statistic: 'Sum',
        threshold: 0,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'notBreaching',
      },
      {
        alarm: 'consumer-errors',
        description:
          'The consumer failed a batch (Zerobus auth, schema or availability). Lambda retries it until it succeeds or the record expires (24 h)',
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensions: { FunctionName: consumer.name },
        statistic: 'Sum',
        threshold: 0,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'notBreaching',
      },
      {
        alarm: 'consumer-iterator-age',
        description:
          'The consumer is over a minute behind the Kinesis stream (stuck retrying a batch or too slow)',
        namespace: 'AWS/Lambda',
        metricName: 'IteratorAge',
        dimensions: { FunctionName: consumer.name },
        statistic: 'Maximum',
        threshold: 60_000,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'notBreaching',
      },
      {
        alarm: 'canary-errors',
        description:
          'The canary could not write to Postgres (writer down, failover in progress, credentials)',
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensions: { FunctionName: canary.name },
        statistic: 'Sum',
        threshold: 2,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'notBreaching',
      },
      {
        alarm: 'cdc-latency-source',
        description:
          'DMS is over a minute behind reading the slot. INSUFFICIENT_DATA after start means the dimension is wrong (README)',
        namespace: 'AWS/DMS',
        metricName: 'CDCLatencySource',
        dimensions: { ReplicationConfigId: replicationConfigId },
        statistic: 'Maximum',
        threshold: 60,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'missing',
      },
      {
        alarm: 'cdc-latency-target',
        description:
          'DMS is over a minute behind writing to Kinesis. INSUFFICIENT_DATA after start means the dimension is wrong (README)',
        namespace: 'AWS/DMS',
        metricName: 'CDCLatencyTarget',
        dimensions: { ReplicationConfigId: replicationConfigId },
        statistic: 'Maximum',
        threshold: 60,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        treatMissingData: 'missing',
      },
      {
        alarm: 'capacity',
        description:
          'DMS Serverless memory is over 90%; it fails with out-of-memory before it scales',
        namespace: 'AWS/DMS',
        metricName: 'CapacityUtilization',
        dimensions: { ReplicationConfigId: replicationConfigId },
        statistic: 'Maximum',
        threshold: 90,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 2,
        treatMissingData: 'missing',
      },
    ]
    const dmsAlarms = dmsAlarmSpecs.map(
      ({ alarm, description, ...metric }) =>
        new aws.cloudwatch.MetricAlarm(`${dmsName}-${alarm}`, {
          name: `${dmsName}-${alarm}`,
          alarmDescription: description,
          period: 300,
          alarmActions: [alarmTopic.arn],
          okActions: [alarmTopic.arn],
          ...metric,
        }),
    )

    dmsOutputs = {
      kinesisStreamName: stream.name,
      dmsReplicationConfigArn: replication.arn,
      dmsReplicationConfigId: replicationConfigId,
      dmsConsumerFunctionName: consumer.name,
      dmsCanaryFunctionName: canary.name,
      zerobusSecretArn: zerobusSecret.arn,
      dmsAlarmNames: dmsAlarms.map((alarm) => alarm.name),
    }
  }

  return {
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
    ...dmsOutputs,
  }
}
