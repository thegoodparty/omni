# Swarm alert forwarder

A Lambda that takes an SNS failure notification and POSTs it to an agent-swarm
workflow webhook, so the Delegate swarm triages gp-ai pipeline failures as bugs
instead of a human reading a Slack channel.

Prod only. `SWARM_ALERT_WEBHOOK_URL` and `SWARM_ALERT_WEBHOOK_SECRET` live in
`AI_SECRETS_PROD`; `AI_SECRETS_DEV` has neither, and dev is not meant to report
failures to the swarm. `var.environment` is validated to `prod` for that reason.
The dev `serve-analyze-fargate` and `ddhq-matcher-fargate` roots keep email
alerts and subscribe nothing.

One instance per consumer (`var.consumer`), so each environment root owns the
whole thing: `serve-analyze-fargate` and `ddhq-matcher-fargate` each instantiate
it and pass its ARN into their own module. Nothing reads another root's state.

## What it sends

For each SNS record:

```json
{
  "topic": "serve-analyze-pipeline-failures-prod",
  "subject": null,
  "message": { "alarm": "...", "exitCode": 1, "logs": "..." },
  "environment": "prod"
}
```

`topic` is the SNS topic name (the ARN's last segment). `message` is the SNS
message parsed as JSON, and kept as a string when it is not JSON — the
Step Functions failure path publishes plain text.

## Signing

[Standard Webhooks](https://www.standardwebhooks.com/), matching the swarm's
`verification: { format: 'standard-webhooks' }` trigger mode:

- `webhook-id`, `webhook-timestamp` (unix seconds) and `webhook-signature` are
  all sent; the id is a fresh UUID per delivery.
- The signed content is `${webhook-id}.${webhook-timestamp}.${body}`, HMAC-SHA256
  keyed with the base64-decoded signing secret.
- `webhook-signature` is `v1,<base64 of that HMAC>`.
- The secret may carry the `whsec_` prefix, which is stripped before base64
  decoding.

The swarm rejects timestamps more than 300 seconds off, so a retry that lands
late re-signs rather than reusing the original headers.

Any non-2xx throws, so Lambda records the invocation as an error and retries it
twice asynchronously; the swarm copy of the alert is dropped after that, since
there is no dead-letter queue. The email subscription on the same topic still
delivers regardless.

## Configuration

Both values are read from the `AI_SECRETS_<ENV>` bundle at cold start. The
parsed pair is cached in the warm container, and cleared on any failure, so a
rotated URL or secret is picked up by the next delivery instead of pinning the
stale one for the container's life.

| Key                          | What                                 |
| ---------------------------- | ------------------------------------ |
| `SWARM_ALERT_WEBHOOK_URL`    | The workflow's webhook trigger URL   |
| `SWARM_ALERT_WEBHOOK_SECRET` | The workflow's `hmacSecret` value    |

The swarm side is a workflow with a webhook trigger, `hmacSecret` holding that
secret, and `verification: { format: 'standard-webhooks' }`.

## Deploying

CI builds `lambda/swarm-alert-forwarder.zip` before any plan runs (the
`gp-ai` PR plan job, and the release train's prod apply job — dev does not build
it, because no dev root instantiates this module), and the terraform
`aws_lambda_function` hashes the zip, so the root ships with the code. The
zip is a build artifact and is not committed.

The subscription and its Lambda permission are gated on
`enable_swarm_alert_forwarder`, not on the ARN, because `count` can only depend
on plan-time-known values and the ARN is a computed attribute of a Lambda created
in the same apply.

## Testing

```bash
cd lambda && npm ci && npm test
```
