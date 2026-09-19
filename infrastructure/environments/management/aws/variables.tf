variable "ssh_public_key_path" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^ssh-rsa [A-Za-z0-9+/]+=*", trimspace(file(var.ssh_public_key_path))))
    error_message = "Use the approved external operator public key file."
  }
}
