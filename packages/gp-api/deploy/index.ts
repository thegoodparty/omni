import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { createAnnotationAttachmentsBucket } from './components/annotation-attachments-bucket'
import { createChatAttachmentsBucket } from './components/chat-attachments-bucket'
import { createCampaignPlanSharesBucket } from './components/campaign-plan-shares-bucket'
import { createAssetsBucket } from './components/assets-bucket'
import { createAssetsRouter } from './components/assets-router'
import { createGrafanaResources } from './components/grafana'
import { createMeetingPipelineBucket } from './components/meeting-pipeline-bucket'
import {
  createPreviewSharedAlb,
  PREVIEW_SHARED_ALB_NAME,
} from './components/preview-shared-alb'
import { createPreviewSharedCluster } from './components/preview-shared-cluster'
import { createRobocallAudioBucket } from './components/robocall-audio-bucket'
import { createService } from './components/service'
import { createSitemapsBucket } from './components/sitemaps-bucket'
import { createVpc } from './components/vpc'

export = async () => {
  const config = new pulumi.Config()

  // Pulumi config returns string — narrowing to known environment literals, validated by select() usage
  const environment = config.require('environment') as
    | 'preview'
    | 'dev'
    | 'prod'
    | 'preview-shared'

  const vpcId = 'vpc-0763fa52c32ebcf6a'
  const hostedZoneId = 'Z10392302OXMPNQLPO07K'

  const vpcSubnetIds = {
    public: ['subnet-07984b965dabfdedc', 'subnet-01c540e6428cdd8db'],
    private: ['subnet-053357b931f0524d4', 'subnet-0bb591861f72dcb7f'],
  }
  const vpcSecurityGroupIds = ['sg-01de8d67b0f0ec787']

  const previewCertificateArn =
    'arn:aws:acm:us-west-2:333022194791:certificate/b009d1a6-68ff-4d24-84f7-93683ca3f786'

  // Infrastructure every PR preview shares, in its own stack so it neither
  // rides the release train nor waits on a dev deploy.
  if (environment === 'preview-shared') {
    createPreviewSharedAlb({
      vpcId,
      publicSubnetIds: vpcSubnetIds.public,
      hostedZoneId,
      certificateArn: previewCertificateArn,
    })
    return {}
  }

  const imageUri = config.require('imageUri')

  const prNumber =
    environment === 'preview' ? config.require('prNumber') : undefined

  const stage = {
    preview: `pr-${prNumber}`,
    dev: 'develop',
    prod: 'master',
  }[environment]

  const select = <T>(values: Record<'preview' | 'dev' | 'prod', T>): T =>
    values[environment]

  // Production deploy manages the VPC. The actual VPC details are hard-coded above as individual variables.
  if (environment === 'prod') {
    createVpc()
    // One global bucket serving prod sitemaps, so only the prod stack
    // creates it (same single-owner pattern as the preview shared cluster
    // on the dev stack).
    createSitemapsBucket()
  }

  const secretName = select({
    preview: 'GP_API_DEV',
    dev: 'GP_API_DEV',
    prod: 'GP_API_PROD',
  })

  const secretVersion = await aws.secretsmanager.getSecretVersion({
    secretId: secretName,
  })

  const secretInfo = await aws.secretsmanager.getSecret({
    name: secretName,
  })

  // JSON.parse returns any — AWS secret is always a string-keyed object, validated by key checks below
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const secret: Record<string, string> = JSON.parse(
    secretVersion.secretString || '{}',
  ) as Record<string, string>

  if (!secret.DB_PASSWORD) {
    throw new Error('DB_PASSWORD must be set in the secret.')
  }

  const dlq = new aws.sqs.Queue('main-dlq', {
    name: `${stage}-DLQ.fifo`,
    fifoQueue: true,
    messageRetentionSeconds: 7 * 24 * 60 * 60, // 7 days
  })

  const queue = new aws.sqs.Queue('main-queue', {
    name: `${stage}-Queue.fifo`,
    fifoQueue: true,
    visibilityTimeoutSeconds: 300, // 5 minutes
    messageRetentionSeconds: 7 * 24 * 60 * 60, // 7 days
    delaySeconds: 0,
    receiveWaitTimeSeconds: 0,
    deduplicationScope: 'messageGroup',
    fifoThroughputLimit: 'perMessageGroupId',
    redrivePolicy: pulumi.jsonStringify({
      deadLetterTargetArn: dlq.arn,
      maxReceiveCount: 3,
    }),
  })

  const tevynPollCsvsBucket = new aws.s3.Bucket('tevyn-poll-csvs-bucket', {
    bucket: `tevyn-poll-csvs-${stage}`,
    forceDestroy: environment === 'preview',
  })

  new aws.s3.BucketPublicAccessBlock('tevyn-poll-csvs-pab', {
    bucket: tevynPollCsvsBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  const zipToAreaCodeBucket = new aws.s3.Bucket('zip-to-area-code-bucket', {
    bucket: `zip-to-area-code-mappings-${stage}`,
    forceDestroy: environment === 'preview',
  })
  new aws.s3.BucketPublicAccessBlock('zip-to-area-code-mappings-pab', {
    bucket: zipToAreaCodeBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  })

  // Private bucket for top-level note attachments (camera shots / uploads).
  // Browser PUTs via presigned URL; gp-api task role reads back for OCR.
  // Preview environments share the dev bucket — no per-PR bucket.
  const annotationAttachmentsBucketName =
    environment === 'preview'
      ? 'annotation-attachments-dev'
      : createAnnotationAttachmentsBucket({ environment }).bucket.bucket

  // Private bucket for chief-of-staff chat attachments (PDFs, images, Word
  // docs, URL snapshots). Browser POSTs via presigned POST; gp-api reads back
  // for text extraction. Preview environments share the dev bucket.
  const chatAttachmentsBucketName =
    environment === 'preview'
      ? 'goodparty-chat-attachments-dev'
      : createChatAttachmentsBucket({ environment }).bucket.bucket

  // Private bucket for shared campaign-plan PDFs. Preview shares the dev
  // bucket — no per-PR buckets.
  const campaignPlanSharesBucketName =
    environment === 'preview'
      ? 'campaign-plan-shares-dev'
      : createCampaignPlanSharesBucket({ environment }).bucket.bucket

  // Private bucket for recorded/uploaded robocall audio. Browser uploads via
  // presigned POST; gp-api task role reads back for delivery. Preview shares
  // the dev bucket — no per-PR bucket.
  const robocallAudioBucketName =
    environment === 'preview'
      ? 'robocall-audio-dev'
      : createRobocallAudioBucket({ environment }).bucket.bucket

  // Private bucket for user-supplied inputs to agent experiment runs (first
  // use: agenda packets uploaded from /briefings). Browser PUTs via presigned
  // URL; the broker reads on the runner's behalf via /inputs/read. Created
  // and owned by gp-ai Terraform (modules/agent-run-inputs); gp-api
  // references by name only. Preview environments share the dev bucket.
  const agentRunInputsBucketName = `gp-agent-run-inputs-${
    environment === 'preview' ? 'dev' : environment
  }`

  // Agent experiment RESULT artifacts. Written by the external agent runner
  // (gp-ai); gp-api reads them back in
  // CampaignStrategyService.onExperimentRunCompleted (e.g. the campaign
  // tracker's dynamic tasks) via s3.getFile. gp-api references by name only;
  // preview shares the dev bucket. Without the read grant below the SQS
  // completion handler 403s and requeues forever, so dynamic tracker tasks
  // never persist.
  const agentArtifactsBucketName = `gp-agent-artifacts-${
    environment === 'preview' ? 'dev' : environment
  }`

  // Shared bucket between the external meeting_pipeline (writes briefings)
  // and gp-api TextToSpeechService (caches Polly audio under speech/synth/,
  // then hands the browser presigned GETs). Dev bucket exists out-of-band
  // and is not Pulumi-owned, so preview/dev just reference its name. The
  // prod bucket is created here.
  const meetingPipelineBucketName =
    environment === 'preview' || environment === 'dev'
      ? 'meeting-pipeline-dev'
      : createMeetingPipelineBucket({ environment }).bucket.bucket

  // Assets bucket - used for storing uploaded files, images, etc.
  if (environment !== 'preview') {
    const assetsBucket = createAssetsBucket({ environment })

    createAssetsRouter({
      environment,
      bucket: assetsBucket.bucket,
      bucketRegionalDomainName: assetsBucket.bucketRegionalDomainName,
      hostedZoneId,
    })
  }

  const skipPerPrRds = environment === 'preview'

  // With the shared preview DB the per-PR cluster is skipped, so its security
  // group and subnet group would be orphaned — skip them too.
  const rdsSecurityGroup = skipPerPrRds
    ? undefined
    : new aws.ec2.SecurityGroup('rdsSecurityGroup', {
        name:
          environment === 'dev'
            ? 'api-rds-security-group'
            : `api-${stage}-rds-security-group`,
        description: 'Allow traffic to RDS',
        vpcId,
        ingress: [
          {
            protocol: 'tcp',
            fromPort: 5432,
            toPort: 5432,
            description: 'gp-api app tasks (shared app security group)',
            securityGroups: vpcSecurityGroupIds,
          },
          // Engineer DB access (psql, migrations, debugging) arrives through the
          // OpenVPN server, which NATs VPN clients behind its own private IP — so
          // Postgres sees that instance, not the client. Scoped to the VPN
          // server's security group, not the whole VPC CIDR the rule below once
          // used, so it restores human access without re-widening blast radius.
          {
            protocol: 'tcp',
            fromPort: 5432,
            toPort: 5432,
            description: 'openvpn server (engineer VPN access)',
            securityGroups: ['sg-0fa26a075716d3173'],
          },
          // The previous whole-VPC-CIDR rule (cidrBlocks: ['10.0.0.0/16']) was
          // removed: it let anything in the VPC reach Postgres. App tasks
          // already reach RDS via the app security group rule above, so the
          // broad CIDR grant only widened the blast radius.
          {
            protocol: 'tcp',
            fromPort: 5432,
            toPort: 5432,
            description: 'databricks via vpc peering',
            cidrBlocks: ['172.16.0.0/16'],
          },
          ...select({
            preview: [],
            // TODOSWAIN: investigate whether these are truly needed in dev
            dev: [
              {
                protocol: 'tcp',
                fromPort: 5432,
                toPort: 5432,
                description: 'internal gp-bastion',
                securityGroups: ['sg-05a21af11aacbe60b'],
              },
            ],
            prod: [
              // Airbyte reaches prod Postgres through this bastion; it lost
              // access when the whole-VPC-CIDR rule was removed.
              {
                protocol: 'tcp',
                fromPort: 5432,
                toPort: 5432,
                description: 'internal gp-bastion',
                securityGroups: ['sg-05a21af11aacbe60b'],
              },
            ],
          }),
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

  const subnetGroup = skipPerPrRds
    ? undefined
    : new aws.rds.SubnetGroup('subnetGroup', {
        name:
          environment === 'dev'
            ? 'api-rds-subnet-group'
            : `api-${stage}-rds-subnet-group`,
        subnetIds: vpcSubnetIds.private,
        tags: {
          Name: `api-${stage}-rds-subnet-group`,
        },
      })

  const rdsCluster = skipPerPrRds
    ? undefined
    : new aws.rds.Cluster('rdsCluster', {
        clusterIdentifier: select({
          preview: `gp-api-${stage}`,
          dev: 'gp-api-db',
          prod: 'gp-api-db-prod',
        }),
        engine: aws.rds.EngineType.AuroraPostgresql,
        engineMode: aws.rds.EngineMode.Provisioned,
        engineVersion: '16.8',
        databaseName: 'gpdb',
        masterUsername: 'gpuser',
        masterPassword: pulumi.secret(secret.DB_PASSWORD),
        dbSubnetGroupName: subnetGroup!.name,
        vpcSecurityGroupIds: [rdsSecurityGroup!.id],
        storageEncrypted: true,
        serverlessv2ScalingConfiguration: {
          minCapacity: environment === 'prod' ? 1 : 0.5,
          maxCapacity: 64,
        },
        backupRetentionPeriod: select({
          preview: 1,
          dev: 7,
          prod: 14,
        }),
        deletionProtection: true,
        skipFinalSnapshot: false,
        finalSnapshotIdentifier: `gp-api-db-${stage}-final-snapshot`,
      })

  const rdsInstance = skipPerPrRds
    ? undefined
    : new aws.rds.ClusterInstance('rdsInstance', {
        clusterIdentifier: rdsCluster!.id,
        instanceClass: 'db.serverless',
        engine: aws.rds.EngineType.AuroraPostgresql,
        engineVersion: rdsCluster!.engineVersion,
      })

  // The dev stack owns the always-on shared preview Aurora cluster. Every PR
  // preview clones its own gpdb_pr_<n> database onto this one cluster (see
  // docker-entrypoint.sh) instead of provisioning a cluster per PR.
  if (environment === 'dev') {
    createPreviewSharedCluster({
      vpcId,
      privateSubnetIds: vpcSubnetIds.private,
      appSecurityGroupIds: vpcSecurityGroupIds,
      dbPassword: secret.DB_PASSWORD,
    })
  }

  // Falls back to a per-PR ALB while the shared one does not exist, so
  // previews keep deploying if the gp-api-preview-shared stack is missing.
  const sharedPreviewListener =
    environment === 'preview'
      ? await aws.lb
          .getLoadBalancer({ name: PREVIEW_SHARED_ALB_NAME })
          .then((lb) =>
            aws.lb.getListener({ loadBalancerArn: lb.arn, port: 443 }),
          )
          .catch(() => undefined)
      : undefined

  const sharedPreviewCluster = skipPerPrRds
    ? await aws.rds.getCluster({
        clusterIdentifier: 'gp-api-preview-shared-db',
      })
    : undefined

  const productDomain = select({
    preview: 'dev.goodparty.org',
    dev: 'dev.goodparty.org',
    prod: 'goodparty.org',
  })

  const domain = select({
    preview: `${stage}.preview.goodparty.org`,
    dev: 'gp-api-dev.goodparty.org',
    prod: 'gp-api.goodparty.org',
  })

  // --- Task-role resource scoping ------------------------------------------
  // The gp-api task role is granted access only to the specific S3 buckets and
  // SQS queues this service actually uses (enumerated from the environment
  // variables below), rather than account-wide s3:*/sqs:* on Resource '*'. A
  // compromised task credential can then only reach gp-api's own resources,
  // not every bucket/queue in the account.
  const region = 'us-west-2'
  const accountId = '333022194791'

  const serveAnalysisBucketName = `serve-analyze-data-${
    environment === 'preview' ? 'dev' : environment
  }`
  const assetsBucketName = select({
    preview: 'assets-dev.goodparty.org',
    dev: 'assets-dev.goodparty.org',
    prod: 'assets.goodparty.org',
  })
  const campaignPlanResultsBucketName = select({
    preview: '',
    dev: 'campaign-plan-results-dev',
    prod: '',
  })

  const taskRoleBucketNames: pulumi.Input<string>[] = [
    tevynPollCsvsBucket.bucket,
    zipToAreaCodeBucket.bucket,
    annotationAttachmentsBucketName,
    chatAttachmentsBucketName,
    campaignPlanSharesBucketName,
    robocallAudioBucketName,
    agentRunInputsBucketName,
    meetingPipelineBucketName,
    serveAnalysisBucketName,
    assetsBucketName,
    ...(campaignPlanResultsBucketName ? [campaignPlanResultsBucketName] : []),
  ]

  const taskRoleBucketArns = taskRoleBucketNames.map(
    (name) => pulumi.interpolate`arn:aws:s3:::${name}`,
  )
  const taskRoleObjectArns = taskRoleBucketNames.map(
    (name) => pulumi.interpolate`arn:aws:s3:::${name}/*`,
  )

  // Buckets gp-api only reads (externally written), granted GetObject/ListBucket
  // but not write/delete. The agent-artifacts bucket is written by the agent
  // runner (gp-ai); gp-api only reads results in
  // onExperimentRunCompleted.
  //
  // The Universal Judge also uses this bucket, under its own reserved
  // top-level prefix, to cache baseline agent outputs between runs. No write
  // is granted here on purpose: a judge run is a CI job that checks out the PR
  // head and its base side by side, so whatever writes those objects
  // authenticates as the shared CI OIDC role (`vars.AWS_ROLE_ARN`), never as
  // this ECS task. The bucket is not Pulumi-owned either — gp-ai Terraform
  // creates it in `modules/pmf-engine-control-plane` — and the read below is
  // already whole-bucket, so no judge prefix needs widening on this side.
  const taskRoleReadOnlyBucketNames: pulumi.Input<string>[] = [
    agentArtifactsBucketName,
  ]
  const taskRoleReadOnlyObjectArns = taskRoleReadOnlyBucketNames.map(
    (name) => pulumi.interpolate`arn:aws:s3:::${name}/*`,
  )
  const taskRoleReadOnlyBucketArns = taskRoleReadOnlyBucketNames.map(
    (name) => pulumi.interpolate`arn:aws:s3:::${name}`,
  )

  // The Universal Judge's background runner also sends to this queue, but as a
  // GitHub Actions job under the CI OIDC role rather than as a task, so it is
  // out of this role's scope. The sqs:SendMessage grant below already covers
  // every message gp-api itself sends here; it needs no judge-specific copy.
  const agentDispatchQueueName = select({
    preview: '',
    dev: 'agent-dispatch-dev.fifo',
    prod: 'agent-dispatch-prod.fifo',
  })
  const staticQueueArns = [agentDispatchQueueName]
    .filter((name): name is string => name !== '')
    .map((name) => `arn:aws:sqs:${region}:${accountId}:${name}`)
  const taskRoleQueueArns: pulumi.Input<string>[] = [
    queue.arn,
    dlq.arn,
    ...staticQueueArns,
  ]

  // The curated local-dev bundle POST /v1/dev-env/bundle vends. Dev only:
  // preview and prod never get the id, so the endpoint stays dark there even
  // though preview passes the IS_NON_PROD_DEPLOY gate. The ARN is built by
  // hand rather than looked up (`-*` covers the suffix Secrets Manager adds)
  // so the stack still deploys before the secret is created.
  const localDevEnvSecretId = select({
    preview: '',
    dev: 'LOCAL_DEV_ENV',
    prod: '',
  })
  const localDevEnvSecretArns =
    localDevEnvSecretId === ''
      ? []
      : [
          `arn:aws:secretsmanager:${region}:${accountId}:secret:${localDevEnvSecretId}-*`,
        ]

  // Preview stacks seed the E2E test accounts from these and the preview E2E
  // suite signs in with them. They sit in the shared GP_API_DEV blob under
  // E2E_ names so dev tasks, which share that blob, never receive them.
  const e2eCredentialKeys: Record<string, string> = {
    ADMIN_EMAIL: 'E2E_ADMIN_EMAIL',
    ADMIN_PASSWORD: 'E2E_ADMIN_PASSWORD',
    CANDIDATE_EMAIL: 'E2E_CANDIDATE_EMAIL',
    CANDIDATE_PASSWORD: 'E2E_CANDIDATE_PASSWORD',
  }
  const e2eCredentialSecretKeys = Object.values(e2eCredentialKeys)
  const e2eCredentialsInSecret = e2eCredentialSecretKeys.every(
    (key) => key in secret,
  )
  // Keeps preview deploys working until the four keys are added to the blob.
  if (environment === 'preview' && !e2eCredentialsInSecret) {
    console.warn(
      `WARNING: ${secretName} is missing ${e2eCredentialSecretKeys.join(', ')}. ` +
        'Preview E2E credentials fall back to plain environment values from ' +
        'the deploy runner. Add those keys to the secret to reference them ' +
        'via valueFrom instead.',
    )
  }

  const containerSecrets: Record<string, pulumi.Output<string>> = {
    ...Object.fromEntries(
      Object.keys(secret)
        .filter((key) => !e2eCredentialSecretKeys.includes(key))
        .map((key) => [key, pulumi.interpolate`${secretInfo.arn}:${key}::`]),
    ),
    ...(environment === 'preview' && e2eCredentialsInSecret
      ? Object.fromEntries(
          Object.entries(e2eCredentialKeys).map(([name, key]) => [
            name,
            pulumi.interpolate`${secretInfo.arn}:${key}::`,
          ]),
        )
      : {}),
  }

  const service = createService({
    dependsOn: rdsInstance ? [rdsInstance] : [],
    environment,
    stage,
    imageUri,
    vpcId,
    securityGroupIds: vpcSecurityGroupIds,
    publicSubnetIds: vpcSubnetIds.public,
    privateSubnetIds: vpcSubnetIds.private,
    hostedZoneId,
    domain,
    sharedPreviewListenerArn: sharedPreviewListener?.arn,
    certificateArn: select({
      preview: previewCertificateArn,
      dev: 'arn:aws:acm:us-west-2:333022194791:certificate/227d8028-477a-4d75-999f-60587a8a11e3',
      prod: 'arn:aws:acm:us-west-2:333022194791:certificate/e1969507-2514-4585-a225-917883d8ffef',
    }),
    secrets: containerSecrets,
    environmentVariables: {
      PORT: '80',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'debug',
      OTEL_SERVICE_ENVIRONMENT: environment,
      CORS_ORIGIN: productDomain,
      AWS_REGION: 'us-west-2',
      ASSET_DOMAIN: select({
        preview: 'assets-dev.goodparty.org',
        dev: 'assets-dev.goodparty.org',
        prod: 'assets.goodparty.org',
      }),
      WEBAPP_ROOT_URL: `https://${productDomain}`,
      // Optional marketing-revalidate endpoint override. In prod
      // WEBAPP_ROOT_URL is already the marketing origin, so leaving this empty
      // makes the service fall back to WEBAPP_ROOT + /api/revalidate-person. In
      // non-prod WEBAPP_ROOT_URL is the Clerk-protected product webapp, so dev
      // must point revalidation explicitly at the marketing deployment.
      MARKETING_REVALIDATE_URL: select({
        preview: '',
        dev: 'https://gp-marketing-git-develop-good-party.vercel.app/api/revalidate-person',
        prod: '',
      }),
      AI_MODELS: 'claude-sonnet-4-6',
      LLAMA_AI_ASSISTANT: 'asst_GP_AI_1.0',
      SQS_QUEUE: queue.name,
      // Where the per-send button in a fulfilment Slack message points. Not
      // select()-ed by environment on purpose: gp-admin is a single
      // deployment fronting dev and prod (see gp-webapp/appEnv.ts, which
      // makes the same call for NEXT_PUBLIC_GP_ADMIN_URL), so preview, dev
      // and prod all send staff to the same console.
      GP_ADMIN_BASE_URL: 'https://admin.goodparty.org',
      SQS_QUEUE_BASE_URL: 'https://sqs.us-west-2.amazonaws.com/333022194791',
      CAMPAIGN_PLAN_RESULTS_BUCKET: select({
        preview: '',
        dev: 'campaign-plan-results-dev',
        // prod disabled until we're ready to generate events in prod
        // prod: 'campaign-plan-results-prod',
        prod: '',
      }),
      AGENT_DISPATCH_QUEUE_NAME: select({
        // Preview intentionally omitted — dispatch fails at runtime with a log
        preview: '',
        dev: 'agent-dispatch-dev.fifo',
        prod: 'agent-dispatch-prod.fifo',
      }),
      MEETINGS_AUTOMATION_ENABLED: select({
        preview: '',
        dev: '',
        prod: 'true',
      }),
      // Prod-only on purpose: each weekly regen dispatches a paid CAP run per
      // eligible campaign, so enabling dev would accumulate spend for no
      // audience. Cost was cohort-checked before enabling (Jul 2026).
      CAMPAIGN_TRACKER_AUTOMATION_ENABLED: select({
        preview: '',
        dev: '',
        prod: 'true',
      }),
      SERVE_ANALYSIS_BUCKET_NAME: `serve-analyze-data-${environment === 'preview' ? 'dev' : environment}`,
      MEETING_PIPELINE_BUCKET: meetingPipelineBucketName,
      TEVYN_POLL_CSVS_BUCKET: tevynPollCsvsBucket.bucket,
      ZIP_TO_AREA_CODE_BUCKET: zipToAreaCodeBucket.bucket,
      ANNOTATION_ATTACHMENTS_BUCKET: annotationAttachmentsBucketName,
      CHAT_ATTACHMENTS_BUCKET: chatAttachmentsBucketName,
      CAMPAIGN_PLAN_SHARES_BUCKET: campaignPlanSharesBucketName,
      ROBOCALL_AUDIO_BUCKET: robocallAudioBucketName,
      API_PUBLIC_ROOT_URL: `https://${domain}`,
      AGENT_RUN_INPUTS_BUCKET: agentRunInputsBucketName,
      LOCAL_DEV_ENV_SECRET_ID: localDevEnvSecretId,
      DB_HOST: sharedPreviewCluster
        ? sharedPreviewCluster.endpoint
        : rdsCluster!.endpoint,
      DB_USER: sharedPreviewCluster
        ? sharedPreviewCluster.masterUsername
        : rdsCluster!.masterUsername,
      DB_NAME: sharedPreviewCluster
        ? `gpdb_pr_${prNumber}`
        : rdsCluster!.databaseName,
      SECRETS_MANAGER_KEYS: [
        ...Object.keys(containerSecrets),
        ...(environment === 'preview' && !e2eCredentialsInSecret
          ? Object.keys(e2eCredentialKeys)
          : []),
      ].join(','),
      ...(environment === 'preview' ? { IS_PREVIEW: 'true' } : {}),
      ...(environment === 'preview' && !e2eCredentialsInSecret
        ? {
            ADMIN_EMAIL: process.env.ADMIN_EMAIL,
            ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
            CANDIDATE_EMAIL: process.env.CANDIDATE_EMAIL,
            CANDIDATE_PASSWORD: process.env.CANDIDATE_PASSWORD,
          }
        : {}),
    },
    permissions: [
      {
        Effect: 'Allow',
        Action: ['route53domains:List*', 'route53domains:Get*'],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: ['route53domains:CheckDomainAvailability'],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
        ],
        Resource: taskRoleObjectArns,
      },
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:GetBucketLocation'],
        Resource: taskRoleBucketArns,
      },
      {
        Effect: 'Allow',
        Action: ['s3:GetObject'],
        Resource: taskRoleReadOnlyObjectArns,
      },
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:GetBucketLocation'],
        Resource: taskRoleReadOnlyBucketArns,
      },
      {
        Effect: 'Allow',
        Action: [
          'sqs:SendMessage',
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueUrl',
          'sqs:GetQueueAttributes',
          'sqs:ChangeMessageVisibility',
        ],
        Resource: taskRoleQueueArns,
      },
      {
        Effect: 'Allow',
        Action: [
          'ssmmessages:OpenDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:CreateControlChannel',
        ],
        Resource: ['*'],
      },
      {
        // Robocall compliance transcribes the recorded audio (batch Transcribe
        // reads the clip from + writes the transcript to ROBOCALL_AUDIO_BUCKET,
        // already covered by the S3 statements above). Transcribe job actions
        // don't support resource scoping, so they're account-wide.
        Effect: 'Allow',
        Action: [
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
        ],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: ['polly:SynthesizeSpeech'],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: [
          'transcribe:StartStreamTranscription',
          'transcribe:StartStreamTranscriptionWebSocket',
        ],
        Resource: ['*'],
      },
      {
        // OCR for annotation note attachments. DetectDocumentText reads the
        // S3 object using the caller's credentials, so the s3:GetObject grant
        // above covers that side.
        Effect: 'Allow',
        Action: ['textract:DetectDocumentText', 'textract:AnalyzeDocument'],
        Resource: ['*'],
      },
      ...(localDevEnvSecretArns.length > 0
        ? [
            {
              Effect: 'Allow' as const,
              Action: ['secretsmanager:GetSecretValue'],
              Resource: localDevEnvSecretArns,
            },
          ]
        : []),
    ],
  })

  if (environment !== 'preview') {
    await createGrafanaResources({ environment, domain })
  }

  return {
    serviceUrl: service.url,
  }
}
