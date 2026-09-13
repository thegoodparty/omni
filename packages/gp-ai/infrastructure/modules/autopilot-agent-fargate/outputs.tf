output "cluster_name" {
  value       = aws_ecs_cluster.agent.name
  description = "ECS cluster name"
}

output "cluster_arn" {
  value       = aws_ecs_cluster.agent.arn
  description = "ECS cluster ARN"
}

output "task_definition_arn" {
  value       = aws_ecs_task_definition.agent.arn
  description = "Base autopilot-agent ECS task definition ARN (epic-create/story/resume stages)"
}

output "task_definition_family" {
  value       = aws_ecs_task_definition.agent.family
  description = "Base autopilot-agent ECS task definition family"
}

output "task_definition_arn_playwright" {
  value       = aws_ecs_task_definition.agent_playwright.arn
  description = "Playwright-installed autopilot-agent ECS task definition ARN (qa stage only)"
}

output "task_definition_family_playwright" {
  value       = aws_ecs_task_definition.agent_playwright.family
  description = "Playwright-installed autopilot-agent ECS task definition family"
}

output "security_group_id" {
  value       = aws_security_group.ecs_tasks.id
  description = "Security group ID for ECS tasks"
}

output "task_execution_role_arn" {
  value       = aws_iam_role.task_execution_role.arn
  description = "Task execution role ARN"
}

output "task_role_arn" {
  value       = aws_iam_role.task_role.arn
  description = "Task role ARN"
}

output "sns_topic_arn" {
  value       = aws_sns_topic.agent_failures.arn
  description = "SNS topic for agent failure notifications"
}
