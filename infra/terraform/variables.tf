variable "do_token" {
  description = "DigitalOcean API token (Account → API → Generate New Token, read+write)"
  type        = string
  sensitive   = true
}

variable "dns_zone" {
  description = "Domain already added under DigitalOcean's Networking → Domains (e.g. example.com)"
  type        = string
}

variable "app_hostname" {
  description = "Record name relative to dns_zone — \"@\" for the apex domain, or e.g. \"app\" for app.example.com"
  type        = string
  default     = "@"
}

variable "letsencrypt_email" {
  description = "Email Let's Encrypt sends expiry/security notices to"
  type        = string
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key allowed to log into the droplet"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "droplet_region" {
  description = "DigitalOcean region slug — blr1 (Bangalore) for lowest latency to NSE/Indian broker APIs"
  type        = string
  default     = "blr1"
}

variable "droplet_size" {
  description = "DigitalOcean droplet size slug — s-2vcpu-4gb comfortably fits postgres+redis+mongo+backend+frontend+nginx"
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "repo_url" {
  description = "Public HTTPS git URL to clone on first boot"
  type        = string
  default     = "https://github.com/manju2606/MTS-Dev.git"
}

variable "repo_branch" {
  description = "Branch to check out on first boot"
  type        = string
  default     = "main"
}

variable "anthropic_api_key" {
  description = "AI Analysis / signal generation — leave blank to skip AI features for now"
  type        = string
  sensitive   = true
  default     = ""
}
