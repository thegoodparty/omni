import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DMS_HEADER_COLUMNS } from './lambda/dms-zerobus/dmsRecord'
import {
  MIRRORED_TABLES,
  SOURCE_SCHEMA,
} from './lambda/dms-zerobus/mirroredTables'

export const createDms = ({
  config,
  name,
  vpc,
  subnets,
  securityGroup,
  cluster,
  alarmTopic,
}: {
  config: pulumi.Config
  name: string
  vpc: pulumi.Output<aws.ec2.GetVpcResult>
  subnets: pulumi.Output<aws.ec2.GetSubnetsResult>
  securityGroup: aws.ec2.SecurityGroup
  cluster: aws.rds.Cluster
  alarmTopic: aws.sns.Topic
}): Record<string, pulumi.Input<unknown>> => {
  const lambdaDist = join(__dirname, 'lambda', 'dms-zerobus', 'dist')
  if (!existsSync(join(lambdaDist, 'consumer', 'index.js'))) {
    throw new Error(
      'enableDms needs the Lambda bundles: run lambda/dms-zerobus/build.sh first',
    )
  }
  const dmsName = `${name}-dms`
  const metricsNamespace = 'GpPocReplication/Dms'
  const metricsPipeline = 'dms-zerobus'
  const region = aws.getRegionOutput().name

  const stream = new aws.kinesis.Stream(dmsName, {
    name: dmsName,
    streamModeDetails: { streamMode: 'ON_DEMAND' },
    retentionPeriod: 24,
  })

  const dmsSecurityGroup = new aws.ec2.SecurityGroup(`${dmsName}-sg`, {
    name: `${dmsName}-sg`,
    description: 'gp-api replication POC: DMS Serverless replication',
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
        description: 'gp-api replication POC: Kinesis VPC endpoint',
        vpcId: vpc.id,
      },
    )
    new aws.vpc.SecurityGroupIngressRule(`${dmsName}-kinesis-endpoint-https`, {
      securityGroupId: endpointSecurityGroup.id,
      description: 'https from the vpc',
      ipProtocol: 'tcp',
      fromPort: 443,
      toPort: 443,
      cidrIpv4: vpc.cidrBlock,
    })
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
      replicationSubnetGroupDescription: 'gp-api replication POC',
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
    databaseName: cluster.databaseName,
    username: config.get('dmsSourceUsername') ?? 'dms_repl',
    password: config.requireSecret('dmsSourcePassword'),
    sslMode: 'require',
    postgresSettings: {
      pluginName: 'test_decoding',
      heartbeatEnable: true,
      heartbeatFrequency: 1,
      heartbeatSchema: 'awsdms',
      captureDdls: true,
      ddlArtifactsSchema: 'awsdms',
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

  const mirroredTables = Object.keys(MIRRORED_TABLES)
  const headerColumns = [
    [DMS_HEADER_COLUMNS.changeSeq, '$AR_H_CHANGE_SEQ'],
    [DMS_HEADER_COLUMNS.commitTimestamp, '$AR_H_COMMIT_TIMESTAMP'],
    [DMS_HEADER_COLUMNS.streamPosition, '$AR_H_STREAM_POSITION'],
  ]
  const tableMappings = {
    rules: [
      ...mirroredTables.map((table, i) => ({
        'rule-type': 'selection',
        'rule-id': String(i + 1),
        'rule-name': `include-${table}`,
        'object-locator': { 'schema-name': SOURCE_SCHEMA, 'table-name': table },
        'rule-action': 'include',
      })),
      ...headerColumns.map(([column, expression], i) => ({
        'rule-type': 'transformation',
        'rule-id': String(mirroredTables.length + i + 1),
        'rule-name': `add${column}`,
        'rule-target': 'column',
        'object-locator': { 'schema-name': SOURCE_SCHEMA, 'table-name': '%' },
        'rule-action': 'add-column',
        value: column,
        expression,
        'data-type': { type: 'string', length: 50 },
      })),
    ],
  }

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
    tableMappings: JSON.stringify(tableMappings),
    // Kinesis targets have no full LOB mode and reject batch apply. TEXT and
    // JSONB are NCLOBs to DMS, so limited LOB mode must be on or they are
    // dropped; failTasksOnLobTruncation fails the task rather than truncate a
    // value over LobMaxSize (KB, two bytes per character). The pk-only before
    // image lets the consumer turn a primary key change into a delete.
    replicationSettings: JSON.stringify({
      TargetMetadata: {
        SupportLobs: true,
        FullLobMode: false,
        LimitedSizeLobMode: true,
        LobMaxSize: config.getNumber('dmsLobMaxSizeKb') ?? 256,
        BatchApplyEnabled: false,
      },
      FullLoadSettings: { TargetTablePrepMode: 'DO_NOTHING' },
      BeforeImageSettings: {
        EnableBeforeImage: true,
        FieldName: 'before-image',
        ColumnFilter: 'pk-only',
      },
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
            'goodparty_data_catalog.gp_api_mirror_dms.dms_cdc_change',
          ZEROBUS_SECRET_ARN: zerobusSecret.arn,
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
  const canaryLogs = new aws.cloudwatch.LogGroup(canaryName, {
    name: `/aws/lambda/${canaryName}`,
    retentionInDays: 14,
  })
  const canarySecurityGroup = new aws.ec2.SecurityGroup(canaryName, {
    name: canaryName,
    description: 'gp-api replication POC: path C canary Lambda',
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
          DB_NAME: cluster.databaseName,
          DB_SECRET_ARN: masterSecretArn,
        },
      },
    },
    { dependsOn: [canaryLogs] },
  )
  const canarySchedule = new aws.cloudwatch.EventRule(canaryName, {
    name: canaryName,
    description: 'Path C canary: one replication_canary update a minute',
    scheduleExpression: 'rate(1 minute)',
    state:
      config.getBoolean('dmsCanaryEnabled') === false ? 'DISABLED' : 'ENABLED',
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
        'No canary change reached Zerobus in 10 minutes: DMS stalled (RUNNING but idle, failed, slot lost), Kinesis, the consumer or Zerobus is down',
      namespace: metricsNamespace,
      metricName: 'CanaryChangesDelivered',
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
        'A canary change took over 30 s from Postgres commit to Zerobus ack',
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
      alarm: 'ddl',
      description:
        'DDL on a mirrored table reached the stream. The raw table is unaffected; regenerate the current-state views (generate-views.ts --apply). A rename or type change needs a reload',
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
      alarm: 'truncate',
      description:
        'A mirrored table was truncated. The views still show the old rows until the table is reloaded (README, C reload)',
      namespace: metricsNamespace,
      metricName: 'TruncateRecords',
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
        'The consumer skipped DMS records it could not map (no primary key, no change sequence, not JSON)',
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

  return {
    kinesisStreamName: stream.name,
    dmsSecurityGroupId: dmsSecurityGroup.id,
    dmsReplicationConfigArn: replication.arn,
    dmsReplicationConfigId: replicationConfigId,
    dmsConsumerFunctionName: consumer.name,
    dmsCanaryFunctionName: canary.name,
    zerobusSecretArn: zerobusSecret.arn,
    dmsAlarmNames: dmsAlarms.map((alarm) => alarm.name),
  }
}
