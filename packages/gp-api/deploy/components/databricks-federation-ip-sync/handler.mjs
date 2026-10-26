import { resolve4 } from 'node:dns/promises'
import {
  DeregisterTargetsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2'
import { planTargetChanges } from './target-plan.mjs'

const client = new ElasticLoadBalancingV2Client({})

export const handler = async () => {
  const hostname = process.env.DB_HOSTNAME
  const TargetGroupArn = process.env.TARGET_GROUP_ARN
  const Port = Number(process.env.DB_PORT)

  const resolvedIps = await resolve4(hostname)
  const { TargetHealthDescriptions = [] } = await client.send(
    new DescribeTargetHealthCommand({ TargetGroupArn }),
  )
  const { register, deregister } = planTargetChanges({
    resolvedIps,
    registeredTargets: TargetHealthDescriptions.map((description) => ({
      ip: description.Target.Id,
      state: description.TargetHealth.State,
    })),
  })

  if (register.length > 0) {
    await client.send(
      new RegisterTargetsCommand({
        TargetGroupArn,
        Targets: register.map((Id) => ({ Id, Port })),
      }),
    )
  }
  if (deregister.length > 0) {
    await client.send(
      new DeregisterTargetsCommand({
        TargetGroupArn,
        Targets: deregister.map((Id) => ({ Id, Port })),
      }),
    )
  }
  if (register.length > 0 || deregister.length > 0) {
    console.log(
      JSON.stringify({
        message: 'Re-registered the federation NLB targets',
        hostname,
        registered: register,
        deregistered: deregister,
      }),
    )
  }
}
