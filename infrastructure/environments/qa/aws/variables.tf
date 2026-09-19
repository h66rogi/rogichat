variable "ssh_public_key_path" {
  type        = string
  sensitive   = true
  description = "Absolute path to the approved private ops bootstrap RSA public key; never a private key."
  validation {
    condition     = can(regex("^ssh-rsa [A-Za-z0-9+/]+=*", trimspace(file(var.ssh_public_key_path))))
    error_message = "Lightsail bootstrap requires the approved RSA public key file."
  }
}

variable "bootstrap_ssh_cidrs" {
  type        = set(string)
  description = "Temporary operator IPv4 /32 addresses. Set empty after verified Tailscale access."
  default     = []
  validation {
    condition = alltrue([
      for cidr in var.bootstrap_ssh_cidrs : can(cidrnetmask(cidr)) && endswith(cidr, "/32")
    ])
    error_message = "Bootstrap SSH permits only individual IPv4 /32 addresses."
  }
}

variable "access_phase" {
  type        = string
  default     = "bootstrap"
  description = "bootstrap requires /32 access; tailnet requires prior enrollment/reboot proof and no public SSH."
  validation {
    condition     = contains(["bootstrap", "tailnet"], var.access_phase)
    error_message = "Choose bootstrap or verified tailnet operation."
  }
}

variable "bundle_id" {
  type        = string
  default     = "medium_3_0"
  description = "QA Linux IPv4 bundle: 2 vCPU / 4 GiB / 80 GB, live quote USD 24/month on 2026-09-19."
}

variable "enable_browser_ssh_diagnostics" {
  type        = bool
  default     = false
  description = "Explicitly approved temporary Lightsail browser SSH access for bootstrap diagnosis. Disable immediately after host-key verification."
  validation {
    condition     = !var.enable_browser_ssh_diagnostics || var.access_phase == "bootstrap"
    error_message = "Browser SSH diagnostics are forbidden after bootstrap."
  }
}
