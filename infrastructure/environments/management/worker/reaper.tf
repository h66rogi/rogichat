data "aws_caller_identity" "current" {}
data "archive_file" "reaper" {
  type        = "zip"
  source_file = "${path.module}/../../../atlantis/worker/reaper.py"
  output_path = "${path.module}/.terraform/build/worker-reaper.zip"
}
resource "aws_iam_role" "reaper" {
  name = "rogichat-worker-canary-reaper"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_cloudwatch_log_group" "reaper" {
  name              = "/aws/lambda/rogichat-worker-canary-reaper"
  retention_in_days = 7
}
resource "aws_iam_role_policy" "reaper" {
  name = "terminate-expired-canaries-only"
  role = aws_iam_role.reaper.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = ["ec2:DescribeInstances"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = "ap-northeast-2" } }
      },
      {
        Effect   = "Allow"
        Action   = ["ec2:TerminateInstances"]
        Resource = "arn:aws:ec2:ap-northeast-2:${data.aws_caller_identity.current.account_id}:instance/*"
        Condition = { StringEquals = {
          "ec2:ResourceTag/Project"     = "rogichat"
          "ec2:ResourceTag/Environment" = "management"
          "ec2:ResourceTag/Component"   = "worker-canary"
        } }
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.reaper.arn}:*"
      }
    ]
  })
}
resource "aws_lambda_function" "reaper" {
  depends_on                     = [aws_iam_role_policy.reaper]
  function_name                  = "rogichat-worker-canary-reaper"
  role                           = aws_iam_role.reaper.arn
  filename                       = data.archive_file.reaper.output_path
  source_code_hash               = data.archive_file.reaper.output_base64sha256
  handler                        = "reaper.handler"
  runtime                        = "python3.12"
  architectures                  = ["arm64"]
  memory_size                    = 128
  timeout                        = 30
  reserved_concurrent_executions = 1
  environment { variables = { CANARY_LAUNCH_TEMPLATE_ID = aws_launch_template.canary.id } }
}
resource "aws_cloudwatch_event_rule" "reaper" {
  name                = "rogichat-worker-canary-reaper"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"
}
resource "aws_cloudwatch_event_target" "reaper" {
  rule = aws_cloudwatch_event_rule.reaper.name
  arn  = aws_lambda_function.reaper.arn
  retry_policy {
    maximum_event_age_in_seconds = 300
    maximum_retry_attempts       = 2
  }
}
resource "aws_lambda_permission" "reaper" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reaper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reaper.arn
}
