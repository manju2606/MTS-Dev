output "droplet_public_ip" {
  value = digitalocean_droplet.app.ipv4_address
}

output "app_url" {
  value = "https://${local.fqdn}"
}

output "ssh_command" {
  value = "ssh root@${digitalocean_droplet.app.ipv4_address}"
}

output "bootstrap_log_command" {
  description = "Tail the first-boot script's progress (Docker install, git clone, TLS bootstrap)"
  value       = "ssh root@${digitalocean_droplet.app.ipv4_address} 'tail -f /var/log/mts-bootstrap.log'"
}
