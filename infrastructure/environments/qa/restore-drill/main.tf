# Off by default. This root must use its own restore-drill state, never app state.
variable "enabled" {
  type    = bool
  default = false
}
variable "restore_to_time" {
  type     = string
  default  = null
  nullable = true
  validation {
    condition     = var.restore_to_time == null || can(formatdate("YYYY", var.restore_to_time))
    error_message = "Restore time must be an RFC3339 UTC timestamp."
  }
}
data "aws_rds_cluster" "source" { cluster_identifier = "rogichat-qa" }
resource "aws_rds_cluster" "drill" {
  count                           = var.enabled ? 1 : 0
  cluster_identifier              = "rogichat-qa-restore-drill"
  engine                          = "aurora-mysql"
  engine_version                  = data.aws_rds_cluster.source.engine_version
  db_subnet_group_name            = data.aws_rds_cluster.source.db_subnet_group_name
  db_cluster_parameter_group_name = data.aws_rds_cluster.source.db_cluster_parameter_group_name
  vpc_security_group_ids          = data.aws_rds_cluster.source.vpc_security_group_ids
  storage_encrypted               = true
  storage_type                    = "aurora"
  backup_retention_period         = 1
  deletion_protection             = false
  skip_final_snapshot             = true
  copy_tags_to_snapshot           = true
  restore_to_point_in_time {
    source_cluster_identifier = data.aws_rds_cluster.source.arn
    restore_type              = "full-copy"
    restore_to_time           = var.restore_to_time
  }
  tags = { Purpose = "temporary-restore-drill" }
  lifecycle {
    precondition {
      condition     = var.restore_to_time != null
      error_message = "An exact verified restorable point is required."
    }
  }
}
resource "aws_rds_cluster_instance" "writer" {
  count                      = var.enabled ? 1 : 0
  identifier                 = "rogichat-qa-restore-drill-writer"
  cluster_identifier         = aws_rds_cluster.drill[0].id
  instance_class             = "db.t4g.medium"
  engine                     = aws_rds_cluster.drill[0].engine
  engine_version             = aws_rds_cluster.drill[0].engine_version
  db_subnet_group_name       = data.aws_rds_cluster.source.db_subnet_group_name
  publicly_accessible        = false
  auto_minor_version_upgrade = false
  tags                       = { Purpose = "temporary-restore-drill" }
}
output "endpoint" {
  value     = one(aws_rds_cluster.drill[*].endpoint)
  sensitive = true
}
