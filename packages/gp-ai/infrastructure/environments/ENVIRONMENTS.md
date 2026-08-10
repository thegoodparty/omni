# Environment Strategy: Dev → Prod

## Overview

Two environments. The qa environment was decommissioned on 2026-08-04.

```
Dev (Development) → Prod (Production)
   ↓                     ↓
Unstable            Live Production
```

## Directory Structure

```
infrastructure/environments/
├── dev/
│   ├── serve-analyze-fargate/    ✅ DEPLOYED (V1 Pipeline)
│   └── shared-infra/             ✅ DEPLOYED (ALB + Route53)
│
└── prod/
    ├── serve-analyze-fargate/    ✅ DEPLOYED (V1 Pipeline)
    └── shared-infra/             ✅ DEPLOYED (ALB + Route53)
```

> **Corrected 2026-08-05.** This file previously listed `vpc-01fed488c4047eaae`
> as a separate dev VPC. **That VPC does not exist** — `describe-vpcs` returns
> `InvalidVpcID.NotFound`, and the account holds exactly one application VPC,
> `vpc-0763fa52c32ebcf6a` ("gp-master-api", 10.0.0.0/16). Every environment
> shares it, along with the same subnets, ACM certificate and Route53 zone; only
> `custom_domain_name` differs. Confirmed against the live `ai-dev` and `ai-prod`
> load balancers, both of which report that VPC.
>
> Do not "fix" the committed `*.auto.tfvars` to match an older version of this
> table — doing so points dev at a VPC that isn't there and breaks every plan.

## serve-analyze-fargate: Environment Comparison

| Configuration | Dev | Prod |
|---------------|-----|----|
| **Terraform State** | `serve-analyze-fargate/dev/terraform.tfstate` | `serve-analyze-fargate/prod/terraform.tfstate` |
| **Environment Variable** | `"dev"` | `"prod"` |
| **VPC ID** | `vpc-0763fa52c32ebcf6a` | `vpc-0763fa52c32ebcf6a` |
| **Private Subnets** | 2 AZs (shared) | 2 AZs (shared) |
| **Docker Image Tag** | `serve-analyze-dev` | `serve-analyze-prod` |
| **DynamoDB Table** | `serve-message-v1-dev` | `serve-message-v1-prod` |
| **Purpose** | Active development | Live production |
| **Stability** | Unstable | Very stable |
| **Deployment Frequency** | High (multiple/day) | Low (weekly/monthly) |
| **Cost Priority** | Minimize | Optimize |

## AWS Resources by Environment

### Resource Naming Pattern

All resources follow the pattern: `<service>-<component>-<environment>`

| Resource Type | Dev | Prod |
|---------------|-----|----|
| **S3 Bucket** | `serve-analyze-data-dev` | `serve-analyze-data-prod` |
| **ECS Cluster** | `serve-analyze-dev` | `serve-analyze-prod` |
| **Lambda Function** | `serve-analyze-trigger-dev` | `serve-analyze-trigger-prod` |
| **Step Functions** | `serve-analyze-pipeline-dev` | `serve-analyze-pipeline-prod` |
| **SNS Topic** | `serve-analyze-pipeline-failures-dev` | `serve-analyze-pipeline-failures-prod` |
| **CloudWatch Logs** | `/ecs/serve-analyze-dev` | `/ecs/serve-analyze-prod` |
| **Security Group** | `serve-analyze-ecs-tasks-dev` | `serve-analyze-ecs-tasks-prod` |
| **IAM Roles** | `serve-analyze-*-dev` | `serve-analyze-*-prod` |

### ARN Examples

**Dev:**
```
Cluster:        arn:aws:ecs:us-west-2:333022194791:cluster/serve-analyze-dev
Lambda:         arn:aws:lambda:us-west-2:333022194791:function:serve-analyze-trigger-dev
Step Functions: arn:aws:states:us-west-2:333022194791:stateMachine:serve-analyze-pipeline-dev
SNS Topic:      arn:aws:sns:us-west-2:333022194791:serve-analyze-pipeline-failures-dev
```

**Prod:**
```
Cluster:        arn:aws:ecs:us-west-2:333022194791:cluster/serve-analyze-prod
Lambda:         arn:aws:lambda:us-west-2:333022194791:function:serve-analyze-trigger-prod
Step Functions: arn:aws:states:us-west-2:333022194791:stateMachine:serve-analyze-pipeline-prod
SNS Topic:      arn:aws:sns:us-west-2:333022194791:serve-analyze-pipeline-failures-prod
```

## Shared Resources

### ECR Repository (Single, Shared)
```
333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-ai-projects
```

**Docker Image Tags:**
- `serve-analyze-dev:latest` - Dev environment
- `serve-analyze-prod:latest` - Production environment

### Terraform State Bucket (Single, Shared)
```
goodparty-terraform-state-us-west-2
```

**State Keys:**
- `serve-analyze-fargate/dev/terraform.tfstate`
- `serve-analyze-fargate/prod/terraform.tfstate`

## API Endpoints

| Environment | ALB Endpoint | S3 Upload Path |
|-------------|--------------|----------------|
| **Dev** | `https://ai-dev.goodparty.org/serve/messages/process` | `s3://serve-analyze-data-dev/input/` |
| **Prod** | `https://ai.goodparty.org/serve/messages/process` | `s3://serve-analyze-data-prod/input/` |

## Deployment Flow

### Promotion Path

```
┌─────────────┐     ┌─────────────┐
│     DEV     │────▶│    PROD     │
│   (main)    │     │   (live)    │
└─────────────┘     └─────────────┘
      ↓                    ↓
  Unstable            Production
  Frequent            Promote-on-green
  Changes
```

Deploys are Terraform applies driven from CI, not run by hand: the release
train (`release.yml`) applies dev on merge to `main`, then applies prod with the
same commit once its E2E is green on dev. See omni's `docs/deployment.md`.

Manual applies (break-glass / bootstrap only):

```bash
cd infrastructure/environments/dev/serve-analyze-fargate
terraform apply

cd infrastructure/environments/prod/serve-analyze-fargate
terraform apply
```

## Environment-Specific Considerations

### Development (Dev)

**Purpose**: Active feature development and debugging

**Characteristics:**
- ✅ Rapid iteration
- ✅ Breaking changes expected
- ✅ Debug logging enabled
- ✅ Lower resource limits

**Testing Focus:**
- Unit testing
- Feature validation
- Bug reproduction
- API integration testing

**Deployment:**
- CI/CD from `main`
- Multiple deployments per day
- No formal approval needed

### Production (Prod)

**Purpose**: Live customer-facing environment

**Characteristics:**
- ✅ Maximum stability
- ✅ Real customer data
- ✅ SLA requirements
- ✅ Full monitoring and alerting
- ✅ Dedicated VPC

**Testing Focus:**
- Smoke testing
- Canary deployments
- Monitoring and observability
- Incident response

**Deployment:**
- Automated promotion of a `main` commit once its dev checks are green
- Forward-only: the ECS circuit breaker reverts a crash-on-boot; land a fix on
  `main` and let it promote

## Cost Estimation

| Environment | Monthly Cost (Estimated) | Notes |
|-------------|-------------------------|-------|
| **Dev** | $50-100 | Frequent testing, shared VPC |
| **Prod** | $100-500 | Production usage, dedicated resources |
| **Total** | $180-680 | Varies with usage patterns |

**Cost Optimization:**
- Use Fargate Spot for dev (up to 70% savings)
- S3 lifecycle policies archive old data
- CloudWatch log retention (7-30 days dev, 90+ days prod)

## Monitoring and Alerts

### Alert Routing

| Environment | Severity | Destination |
|-------------|----------|-------------|
| **Dev** | Low | `#dev-alerts` Slack channel |
| **Prod** | High | `#prod-alerts` Slack + PagerDuty |

### CloudWatch Alarms

**Dev:**
- Basic error tracking
- Cost anomaly detection

**Prod:**
- Real-time failure alerts
- SLA breach notifications
- Cost overrun alerts
- Security event monitoring

## Security Considerations

| Security Control | Dev | Prod |
|------------------|-----|----|
| **VPC Isolation** | Shared OK | Required |
| **API Key Rotation** | Manual | Monthly |
| **Data Encryption** | At rest | At rest + in transit + field-level |
| **Access Logging** | Basic | Full + audit trail |
| **IAM Policies** | Permissive | Least privilege |
| **Secret Management** | Terraform vars | AWS Secrets Manager recommended |

## Deployment Status

| Environment | Status | Infrastructure | Docker Image | Last Updated |
|-------------|--------|---------------|--------------|--------------|
| **Dev** | ✅ Live | Fully deployed | `serve-analyze-dev` | Active |
| **Prod** | ✅ Live | Fully deployed | `serve-analyze-prod` | Active |

## Deployment History

### Dev
- ✅ Infrastructure deployed and active
- ✅ Docker image: `serve-analyze-dev` (latest)
- ✅ ALB: `ai-dev.goodparty.org`
- ✅ S3 bucket: `serve-analyze-data-dev`

### Prod
- ✅ Infrastructure deployed and active
- ✅ Docker image: `serve-analyze-prod` (latest)
- ✅ ALB: `ai.goodparty.org`
- ✅ S3 bucket: `serve-analyze-data-prod`

## Quick Reference Commands

### Build and Push Images

```bash
# Dev
docker buildx build --platform linux/arm64 -t serve-analyze-dev -f serve/v1_pipeline/Dockerfile .
docker push 333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-ai-projects:serve-analyze-dev

# Prod
docker push 333022194791.dkr.ecr.us-west-2.amazonaws.com/gp-ai-projects:serve-analyze-prod
```

### Deploy Infrastructure

```bash
# Dev
cd infrastructure/environments/dev/serve-analyze-fargate
AWS_PROFILE=work terraform apply

# Prod
cd infrastructure/environments/prod/serve-analyze-fargate
AWS_PROFILE=work terraform apply
```

### Trigger Pipelines

```bash
# Dev
aws s3 cp test.csv s3://serve-analyze-data-dev/input/

# Prod
aws s3 cp test.csv s3://serve-analyze-data-prod/input/
```

### Monitor Executions

```bash
# Dev
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-west-2:333022194791:stateMachine:serve-analyze-pipeline-dev

# Prod
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-west-2:333022194791:stateMachine:serve-analyze-pipeline-prod
```

## Support and Documentation

- **Dev README**: `infrastructure/environments/dev/serve-analyze-fargate/README.md`
- **Prod README**: `infrastructure/environments/prod/serve-analyze-fargate/README.md`
- **Module Documentation**: `infrastructure/modules/serve-analyze-fargate/README.md`
