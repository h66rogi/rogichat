variable "ssh_public_key_path" {
  type        = string
  sensitive   = true
  description = "Approved operator public key file outside this public repository."
  validation {
    condition     = can(regex("^ssh-rsa [A-Za-z0-9+/]+=*", trimspace(file(var.ssh_public_key_path))))
    error_message = "Use the approved operator RSA public key."
  }
}

variable "ami_id" {
  type        = string
  default     = "ami-086a43496cb46286c"
  description = "Pinned Canonical Ubuntu 24.04 amd64 AMI in Seoul; reviewed 2026-09-20."
}

variable "instance_type" {
  type    = string
  default = "t3a.medium"
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.medium"
  description = "Provisioned Aurora MySQL class matched to the reviewed reservation; never serverless."
  validation {
    condition     = var.db_instance_class == "db.t4g.medium"
    error_message = "Changing the reviewed QA database class requires a separate sizing and cost review."
  }
}

variable "db_engine_version" {
  type    = string
  default = "8.0.mysql_aurora.3.10.3"
}
