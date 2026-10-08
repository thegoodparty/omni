import * as aws from '@pulumi/aws'

export const PREVIEW_SHARED_ALB_NAME = 'gp-api-previews'

interface PreviewSharedAlbConfig {
  vpcId: string
  publicSubnetIds: string[]
  hostedZoneId: string
  certificateArn: string
}

// One internet-facing ALB in front of every gp-api PR preview, owned by the
// `gp-api-preview-shared` stack. Each preview stack adds a host-header rule on
// the HTTPS listener and its own target group; `*.preview.goodparty.org`
// points here, so a new preview needs no ALB and no DNS record of its own.
// A per-PR ALB took ~3 minutes to provision and its fresh DNS record another
// ~2 to resolve, on the critical path of every new PR.
export const createPreviewSharedAlb = ({
  vpcId,
  publicSubnetIds,
  hostedZoneId,
  certificateArn,
}: PreviewSharedAlbConfig) => {
  const securityGroup = new aws.ec2.SecurityGroup(
    'previewSharedAlbSecurityGroup',
    {
      name: 'gp-api-previews-alb-sg',
      description: 'Shared gp-api PR preview load balancer',
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
    },
  )

  const loadBalancer = new aws.lb.LoadBalancer('previewSharedAlb', {
    name: PREVIEW_SHARED_ALB_NAME,
    internal: false,
    loadBalancerType: 'application',
    securityGroups: [securityGroup.id],
    subnets: publicSubnetIds,
    enableCrossZoneLoadBalancing: true,
    // Same as the per-env ALBs: long CSV exports stream for minutes.
    idleTimeout: 300,
  })

  new aws.lb.Listener('previewSharedHttpsListener', {
    loadBalancerArn: loadBalancer.arn,
    port: 443,
    protocol: 'HTTPS',
    certificateArn,
    sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
    defaultActions: [
      {
        type: 'fixed-response',
        fixedResponse: {
          contentType: 'text/plain',
          messageBody: 'No gp-api preview is deployed at this address.',
          statusCode: '404',
        },
      },
    ],
  })

  new aws.lb.Listener('previewSharedHttpListener', {
    loadBalancerArn: loadBalancer.arn,
    port: 80,
    protocol: 'HTTP',
    defaultActions: [
      {
        type: 'redirect',
        redirect: { protocol: 'HTTPS', port: '443', statusCode: 'HTTP_301' },
      },
    ],
  })

  for (const type of ['A', 'AAAA']) {
    new aws.route53.Record(`previewSharedWildcard${type}Record`, {
      zoneId: hostedZoneId,
      name: '*.preview.goodparty.org',
      type,
      aliases: [
        {
          name: loadBalancer.dnsName,
          zoneId: loadBalancer.zoneId,
          evaluateTargetHealth: false,
        },
      ],
    })
  }
}
