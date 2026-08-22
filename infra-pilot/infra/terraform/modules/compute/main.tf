# Compute module: ECS cluster, task definitions, services, ALB, auto scaling

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs"
  type        = list(string)
}

variable "environment" {
  description = "Environment name"
  type        = string
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_alb" "main" {
  name            = "${var.name_prefix}-alb"
  internal        = false
  security_groups = [aws_security_group.alb.id]
  subnets         = var.public_subnet_ids
  idle_timeout    = 120
  tags = { Name = "${var.name_prefix}-alb" }
}

resource "aws_alb_target_group" "orchestrator" {
  name        = "${var.name_prefix}-orch-tg"
  port        = 8500
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 3
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_alb_target_group" "management" {
  name        = "${var.name_prefix}-mgmt-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check {
    path                = "/api/health"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 3
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_alb_listener" "http" {
  load_balancer_arn = aws_alb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.orchestrator.arn
  }
}

resource "aws_ecs_task_definition" "orchestrator" {
  family                   = "${var.name_prefix}-orchestrator"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  container_definitions = jsonencode([
    {
      name      = "orchestrator-agent"
      image     = "${var.name_prefix}/orchestrator-agent:latest"
      essential = true
      portMappings = [
        { containerPort = 8500, hostPort = 8500, protocol = "tcp" },
        { containerPort = 8080, hostPort = 8080, protocol = "tcp" }
      ]
      environment = [
        { name = "ENVIRONMENT", value = var.environment },
        { name = "DB_HOST", value = "placeholder" },
        { name = "REDIS_HOST", value = "placeholder" },
        { name = "PORT", value = "8500" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.name_prefix}/orchestrator"
          "awslogs-region"        = "us-east-1"
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "orchestrator" {
  name            = "${var.name_prefix}-orchestrator"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.orchestrator.arn
  desired_count   = var.environment == "prod" ? 3 : 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_alb_target_group.orchestrator.arn
    container_name   = "orchestrator-agent"
    container_port   = 8500
  }
}

resource "aws_iam_role" "ecs_execution" {
  name = "${var.name_prefix}-ecs-exec-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_security_group" "alb" {
  name_prefix = "${var.name_prefix}-alb-"
  vpc_id      = var.vpc_id
  ingress { from_port = 80; to_port = 80; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "${var.name_prefix}-alb-sg" }
}

resource "aws_security_group" "ecs" {
  name_prefix = "${var.name_prefix}-ecs-"
  vpc_id      = var.vpc_id
  ingress { from_port = 0; to_port = 65535; protocol = "tcp"; security_groups = [aws_security_group.alb.id] }
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "${var.name_prefix}-ecs-sg" }
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  value = aws_alb.main.dns_name
}

output "security_group_ids" {
  value = [aws_security_group.alb.id, aws_security_group.ecs.id]
}

output "orchestrator_target_group_arn" {
  value = aws_alb_target_group.orchestrator.arn
}

output "management_target_group_arn" {
  value = aws_alb_target_group.management.arn
}