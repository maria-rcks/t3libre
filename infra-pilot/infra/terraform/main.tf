# Terraform configuration for Infra Pilot infrastructure deployment
# Provider configurations, backend, and root module

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
  backend "s3" {
    bucket         = "infra-pilot-terraform-state"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "infra-pilot-terraform-locks"
  }
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "ecr_repository_names" {
  description = "List of ECR repository names"
  type        = list(string)
  default     = ["infra-pilot/orchestrator-agent", "infra-pilot/management-panel", "infra-pilot/discord-service"]
}

locals {
  name_prefix = "infra-pilot-${var.environment}"
  common_tags = {
    Project     = "Infra Pilot"
    Environment = var.environment
    ManagedBy   = "Terraform"
    Owner       = "infra-pilot-team"
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = local.common_tags
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

module "networking" {
  source = "./modules/network"
  vpc_cidr = var.vpc_cidr
  name_prefix = local.name_prefix
  availability_zones = data.aws_availability_zones.available.names
}

module "compute" {
  source = "./modules/compute"
  name_prefix = local.name_prefix
  vpc_id = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
  private_subnet_ids = module.networking.private_subnet_ids
  environment = var.environment
}

module "storage" {
  source = "./modules/storage"
  name_prefix = local.name_prefix
  db_instance_class = var.db_instance_class
  redis_node_type = var.redis_node_type
  subnet_ids = module.networking.private_subnet_ids
  security_group_ids = module.compute.security_group_ids
}

module "monitoring" {
  source = "./modules/monitoring"
  name_prefix = local.name_prefix
  vpc_id = module.networking.vpc_id
  subnet_ids = module.networking.public_subnet_ids
}

resource "aws_ecr_repository" "repos" {
  for_each = toset(var.ecr_repository_names)
  name = each.value
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

output "vpc_id" {
  value = module.networking.vpc_id
}

output "rds_endpoint" {
  value = module.storage.rds_endpoint
}

output "redis_endpoint" {
  value = module.storage.redis_endpoint
}

output "alb_dns_name" {
  value = module.compute.alb_dns_name
}

output "ecr_repository_urls" {
  value = { for k, v in aws_ecr_repository.repos : k => v.repository_url }
}

output "ecs_cluster_name" {
  value = module.compute.ecs_cluster_name
}