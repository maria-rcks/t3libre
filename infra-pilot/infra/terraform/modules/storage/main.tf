# Storage module: RDS PostgreSQL, ElastiCache Redis, EFS file system

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for database subnets"
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security group IDs for ECS tasks"
  type        = list(string)
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db-subnet"
  subnet_ids = var.subnet_ids
  tags = { Name = "${var.name_prefix}-db-subnet" }
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.name_prefix}-rds-"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.security_group_ids
  }
  tags = { Name = "${var.name_prefix}-rds-sg" }
}

data "aws_vpc" "default" {
  default = false
  tags = { Name = "${var.name_prefix}-vpc" }
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.name_prefix}-postgres"
  engine                 = "postgres"
  engine_version         = "16.3"
  instance_class         = var.db_instance_class
  allocated_storage      = 100
  max_allocated_storage  = 500
  storage_encrypted      = true
  storage_type           = "gp3"
  db_name                = "infrapilot"
  username               = "infrapilot"
  password               = random_password.db_password.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:05:00-sun:06:00"
  multi_az               = true
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.name_prefix}-postgres-final"
  deletion_protection    = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  tags = { Name = "${var.name_prefix}-postgres" }
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.name_prefix}-redis-subnet"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.name_prefix}-redis-"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = var.security_group_ids
  }
  tags = { Name = "${var.name_prefix}-redis-sg" }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id          = "${var.name_prefix}-redis"
  engine                        = "redis"
  engine_version                = "7.1"
  node_type                     = var.redis_node_type
  num_cache_clusters            = 2
  port                          = 6379
  parameter_group_name          = "default.redis7"
  subnet_group_name             = aws_elasticache_subnet_group.redis.name
  security_group_ids            = [aws_security_group.redis.id]
  automatic_failover_enabled    = true
  multi_az_enabled              = true
  at_rest_encryption_enabled    = true
  transit_encryption_enabled    = true
  auto_minor_version_upgrade    = true
  tags = { Name = "${var.name_prefix}-redis" }
}

resource "aws_efs_file_system" "shared" {
  creation_token = "${var.name_prefix}-shared"
  encrypted      = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"
  tags = { Name = "${var.name_prefix}-shared" }
}

resource "aws_efs_mount_target" "shared" {
  count          = length(var.subnet_ids)
  file_system_id  = aws_efs_file_system.shared.id
  subnet_id       = var.subnet_ids[count.index]
  security_groups = var.security_group_ids
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.endpoint
  sensitive = true
}

output "rds_password" {
  value = random_password.db_password.result
  sensitive = true
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "efs_id" {
  value = aws_efs_file_system.shared.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}