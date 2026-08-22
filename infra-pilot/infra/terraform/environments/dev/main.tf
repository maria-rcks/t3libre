# Dev environment Terraform
terraform {
  backend "s3" {
    bucket         = "infra-pilot-terraform-state"
    key            = "environments/dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "infra-pilot-terraform-locks"
  }
}

provider "aws" {
  region = "us-east-1"
}

module "infra_pilot" {
  source = "../../"
  environment = "dev"
  region = "us-east-1"
  vpc_cidr = "10.0.0.0/16"
  db_instance_class = "db.t3.small"
  redis_node_type = "cache.t3.micro"
}

output "vpc_id" { value = module.infra_pilot.vpc_id }
output "rds_endpoint" { value = module.infra_pilot.rds_endpoint }
output "redis_endpoint" { value = module.infra_pilot.redis_endpoint }
output "alb_dns_name" { value = module.infra_pilot.alb_dns_name }
output "ecr_repository_urls" { value = module.infra_pilot.ecr_repository_urls }
output "ecs_cluster_name" { value = module.infra_pilot.ecs_cluster_name }