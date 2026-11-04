import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

// The infrastructure account's swarm host role writes each wave's reply export
// here; the role is defined in the ops repo.
const SWARM_HOST_ROLE_ARN = 'arn:aws:iam::394495727159:role/delegate-swarm-host'

const REPLIES_PREFIX = 'agent-replies/'

type Args = {
  bucket: aws.s3.Bucket
  queue: aws.sqs.Queue
}

// A reply export landing under agent-replies/ becomes a panelRepliesUploaded
// message on the main queue. Dev and prod only: the swarm never writes to a
// preview's bucket.
export const createPanelRepliesIngest = ({ bucket, queue }: Args) => {
  new aws.s3.BucketOwnershipControls('tevyn-poll-csvs-ownership', {
    bucket: bucket.id,
    rule: { objectOwnership: 'BucketOwnerEnforced' },
  })

  new aws.s3.BucketPolicy('tevyn-poll-csvs-swarm-put', {
    bucket: bucket.id,
    policy: pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowSwarmHostPutReplies',
          Effect: 'Allow',
          Principal: { AWS: SWARM_HOST_ROLE_ARN },
          Action: 's3:PutObject',
          Resource: pulumi.interpolate`arn:aws:s3:::${bucket.bucket}/${REPLIES_PREFIX}*`,
        },
      ],
    }),
  })

  new aws.s3.BucketNotification('tevyn-poll-csvs-notification', {
    bucket: bucket.id,
    eventbridge: true,
  })

  const rule = new aws.cloudwatch.EventRule('panel-replies-uploaded-rule', {
    description: 'A swarm reply export landed in the tevyn bucket',
    eventPattern: pulumi.jsonStringify({
      source: ['aws.s3'],
      'detail-type': ['Object Created'],
      detail: {
        bucket: { name: [bucket.bucket] },
        object: { key: [{ wildcard: `${REPLIES_PREFIX}*.csv` }] },
      },
    }),
  })

  new aws.cloudwatch.EventTarget('panel-replies-uploaded-target', {
    rule: rule.name,
    arn: queue.arn,
    sqsTarget: { messageGroupId: 'default' },
    inputTransformer: {
      inputPaths: {
        bucket: '$.detail.bucket.name',
        key: '$.detail.object.key',
      },
      inputTemplate:
        '{"type":"panelRepliesUploaded","data":{"bucket":"<bucket>","key":"<key>"}}',
    },
  })

  new aws.sqs.QueuePolicy('main-queue-eventbridge-policy', {
    queueUrl: queue.url,
    policy: pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowPanelRepliesRule',
          Effect: 'Allow',
          Principal: { Service: 'events.amazonaws.com' },
          Action: 'sqs:SendMessage',
          Resource: queue.arn,
          Condition: { ArnEquals: { 'aws:SourceArn': rule.arn } },
        },
      ],
    }),
  })
}
