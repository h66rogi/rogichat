variable "artifact_bucket_name" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^rogichat-worker-[a-z0-9-]{8,32}$", var.artifact_bucket_name))
    error_message = "Supply the private, dedicated worker artifact bucket name."
  }
}

variable "management_private_ip" {
  type      = string
  sensitive = true
  validation {
    condition     = can(cidrhost("${var.management_private_ip}/32", 0)) && startswith(var.management_private_ip, "10.77.")
    error_message = "Use the verified management private IPv4 address."
  }
}

variable "app_private_ip" {
  type      = string
  sensitive = true
  validation {
    condition     = can(cidrhost("${var.app_private_ip}/32", 0)) && startswith(var.app_private_ip, "10.76.")
    error_message = "Use the verified QA app private IPv4 address."
  }
}
