mock_provider "aws" {}

run "normal_operation_closes_public_ssh" {
  command = plan
  variables {
    bootstrap_ssh_cidrs = []
    access_phase        = "tailnet"
  }
  assert {
    condition     = length(aws_lightsail_instance_public_ports.qa.port_info) == 2 && alltrue([for port in aws_lightsail_instance_public_ports.qa.port_info : contains([80, 443], port.from_port)])
    error_message = "Normal operation must expose only web ports; SSH remains on Tailscale."
  }
  assert {
    condition     = aws_lightsail_instance.qa.ip_address_type == "ipv4" && aws_lightsail_instance.qa.key_pair_name == aws_lightsail_key_pair.bootstrap.name
    error_message = "Require explicit IP-family policy and an imported operator key."
  }
  assert {
    condition     = aws_lightsail_instance.qa.name != aws_lightsail_static_ip.qa.name
    error_message = "Lightsail instance and static IP must have distinct resource names."
  }
  assert {
    condition     = startswith(aws_lightsail_instance.qa.user_data, "#!/usr/bin/env bash\n")
    error_message = "Cloud-init shell user_data must start with a shebang."
  }
}

run "bootstrap_ssh_is_scoped" {
  command = plan
  variables {
    bootstrap_ssh_cidrs = ["192.0.2.42/32"]
  }
  assert {
    condition     = alltrue([for port in aws_lightsail_instance_public_ports.qa.port_info : port.from_port != 22 || port.cidrs == toset(["192.0.2.42/32"])])
    error_message = "Bootstrap SSH must use only the operator /32."
  }
}

run "reject_world_open_ssh" {
  command = plan
  variables {
    bootstrap_ssh_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.bootstrap_ssh_cidrs]
}

run "reject_unreachable_initial_host" {
  command = plan
  variables {
    access_phase        = "bootstrap"
    bootstrap_ssh_cidrs = []
  }
  expect_failures = [aws_lightsail_instance.qa]
}
