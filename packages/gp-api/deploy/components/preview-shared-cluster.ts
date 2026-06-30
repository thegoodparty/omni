import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

interface PreviewSharedClusterConfig {
  vpcId: string
  vpcCidr: string
  privateSubnetIds: string[]
  appSecurityGroupIds: string[]
  dbPassword: string
}

// Persistent shared Aurora cluster for all gp-api PR previews. Owned by the
// dev stack (deployed with develop). Per-PR databases (gpdb_pr_<n>) are cloned
// onto this one cluster by the preview entrypoint instead of provisioning a
// cluster per PR.
export const createPreviewSharedCluster = ({
  vpcId,
  vpcCidr,
  privateSubnetIds,
  appSecurityGroupIds,
  dbPassword,
}: PreviewSharedClusterConfig) => {
  const securityGroup = new aws.ec2.SecurityGroup(
    'previewSharedRdsSecurityGroup',
    {
      name: 'api-preview-shared-db-rds-security-group',
      description: 'Allow traffic to the shared preview Aurora cluster',
      vpcId,
      ingress: [
        {
          protocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          securityGroups: appSecurityGroupIds,
        },
        {
          protocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          cidrBlocks: [vpcCidr],
        },
        {
          protocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          description: 'databricks via vpc peering',
          cidrBlocks: ['172.16.0.0/16'],
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
    },
  )

  const subnetGroup = new aws.rds.SubnetGroup('previewSharedSubnetGroup', {
    name: 'api-preview-shared-db-rds-subnet-group',
    subnetIds: privateSubnetIds,
    tags: {
      Name: 'api-preview-shared-db-rds-subnet-group',
    },
  })

  const cluster = new aws.rds.Cluster(
    'previewSharedCluster',
    {
      clusterIdentifier: 'gp-api-preview-shared-db',
      engine: aws.rds.EngineType.AuroraPostgresql,
      engineMode: aws.rds.EngineMode.Provisioned,
      engineVersion: '16.8',
      // No databaseName: the preview entrypoint creates per-PR databases
      // (gpdb_pr_<n>) against the default postgres maintenance DB, so no
      // single initial database is provisioned here.
      masterUsername: 'gpuser',
      masterPassword: pulumi.secret(dbPassword),
      dbSubnetGroupName: subnetGroup.name,
      vpcSecurityGroupIds: [securityGroup.id],
      storageEncrypted: true,
      serverlessv2ScalingConfiguration: {
        minCapacity: 0.5,
        maxCapacity: 64,
      },
      backupRetentionPeriod: 1,
      deletionProtection: true,
      skipFinalSnapshot: true,
    },
    // Write-once: a rotated DB_PASSWORD must not ModifyDBCluster the live
    // shared cluster, which would break every connected preview.
    { ignoreChanges: ['masterPassword'] },
  )

  new aws.rds.ClusterInstance('previewSharedInstance', {
    clusterIdentifier: cluster.id,
    instanceClass: 'db.serverless',
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: cluster.engineVersion,
  })
}
