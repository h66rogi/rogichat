#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
snap list amazon-ssm-agent >/dev/null 2>&1 || snap install amazon-ssm-agent --classic
systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service
apt-get update
apt-get install -y ca-certificates curl ufw docker.io docker-compose-v2
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 22 proto tcp
ufw --force enable
install -d -m 0755 /run/sshd
cat > /etc/ssh/sshd_config.d/00-rogichat.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
SSH
sshd -t
systemctl enable --now ssh
systemctl reload ssh
curl --fail --silent --show-error https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
curl --fail --silent --show-error https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
apt-get update
apt-get install -y tailscale
systemctl enable --now tailscaled docker
tailscale set --accept-dns=false --accept-routes=false --ssh=false
# Enrollment and server-owned authorization are separate reviewed operations.
# Do not start Atlantis, a self-hosted runner, or arbitrary repository workflows.
