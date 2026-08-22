# Monitoring module: Prometheus, Grafana, CloudWatch dashboards, alerts

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for monitoring resources"
  type        = list(string)
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.name_prefix}"
  retention_in_days = 90
  tags = { Name = "${var.name_prefix}-logs" }
}

resource "aws_cloudwatch_log_group" "orchestrator" {
  name              = "/ecs/${var.name_prefix}/orchestrator"
  retention_in_days = 90
}

resource "aws_cloudwatch_log_group" "management" {
  name              = "/ecs/${var.name_prefix}/management-panel"
  retention_in_days = 90
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${var.name_prefix}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "ECS cluster CPU utilization is too high"
  alarm_actions       = []
}

resource "aws_cloudwatch_metric_alarm" "memory_high" {
  alarm_name          = "${var.name_prefix}-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "ECS cluster memory utilization is too high"
  alarm_actions       = []
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.name_prefix}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "ALB 5xx error count is too high"
  alarm_actions       = []
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.name_prefix}-dashboard"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ECS", "CPUUtilization", { stat = "Average" }],
            ["AWS/ECS", "MemoryUtilization", { stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = "us-east-1"
          title  = "ECS Cluster Metrics"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", { stat = "Sum" }],
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "Average" }],
            ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", { stat = "Sum" }]
          ]
          period = 300
          stat   = "Average"
          region = "us-east-1"
          title  = "ALB Metrics"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "DatabaseConnections", { stat = "Average" }],
            ["AWS/RDS", "CPUUtilization", { stat = "Average" }],
            ["AWS/RDS", "FreeableMemory", { stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = "us-east-1"
          title  = "RDS Metrics"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ElastiCache", "CPUUtilization", { stat = "Average" }],
            ["AWS/ElastiCache", "FreeableMemory", { stat = "Average" }],
            ["AWS/ElastiCache", "CurrConnections", { stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = "us-east-1"
          title  = "Redis Metrics"
        }
      }
    ]
  })
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = "alerts@infra-pilot.example.com"
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${var.name_prefix}-rds-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "100"
  alarm_description   = "RDS connection count is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${var.name_prefix}-redis-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "Redis CPU is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

output "cloudwatch_log_group_names" {
  value = [aws_cloudwatch_log_group.ecs.name, aws_cloudwatch_log_group.orchestrator.name, aws_cloudwatch_log_group.management.name]
}

output "sns_topic_arn" {
  value = aws_sns_topic.alerts.arn
}