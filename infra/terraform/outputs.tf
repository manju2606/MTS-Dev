output "instance_public_ip" {
  description = "Point your domain's A record at this IP"
  value       = oci_core_instance.app.public_ip
}

output "ssh_command" {
  value = "ssh ubuntu@${oci_core_instance.app.public_ip}"
}
