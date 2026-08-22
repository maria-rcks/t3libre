# Production environment Terraform
terraform {
  backend "s3" {
    bucket         = "infra-pilot-terraform-state"
    key            = "environments/prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "infra-pilot-terraform-locks"
  }
  required_version = ">= 1.5"
}

provider "aws" {
  region = "us-east-1"
}

module "infra_pilot" {
  source = "../../"
  environment = "prod"
  region = "us-east-1"
  vpc_cidr = "10.0.0.0/16"
  db_instance_class = "db.r6g.large"
  redis_node_type = "cache.r6g.large"
  ecr_repository_names = ["infra-pilot/orchestrator-agent", "infra-pilot/management-panel", "infra-pilot/discord-service"]
}

output "vpc_id" { value = module.infra_pilot.vpc_id }
output "rds_endpoint" { value = module.infra_pilot.rds_endpoint }
output "redis_endpoint" { value = module.infra_pilot.redis_endpoint }
output "alb_dns_name" { value = module.infra_pilot.alb_dns_name }
output "ecr_repository_urls" { value = module.infra_pilot.ecr_repository_urls }
output "ecs_cluster_name" { value = module.infra_pilot.ecs_cluster_name }