terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket       = "goodparty-terraform-state-us-west-2"
    key          = "universal-judge-sweep-policy/dev/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-west-2"

  default_tags {
    tags = {
      Project = "pmf-engine"
    }
  }
}

# Its own root rather than a block inside pmf-engine-control-plane, for the
# same reason the autopilot schedule lives in a workflow: a policy whose
# attachment is a manual step should not be able to fail an apply that owns
# the dispatch queue and the artifacts bucket. Nothing else depends on this
# root's state.
module "universal_judge_sweep_policy" {
  source = "../../../modules/universal-judge-sweep-policy"

  environment = "dev"
}

output "policy_arn" {
  value = module.universal_judge_sweep_policy.policy_arn
}

output "policy_name" {
  value = module.universal_judge_sweep_policy.policy_name
}
