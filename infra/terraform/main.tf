terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

locals {
  fqdn = var.app_hostname == "@" ? var.dns_zone : "${var.app_hostname}.${var.dns_zone}"
}

# ── Secrets — generated once, never typed by hand ──────────────────────────────

resource "random_password" "app_secret_key" {
  length  = 64
  special = false
}

resource "random_password" "postgres_password" {
  length  = 32
  special = false
}

# ── Networking ──────────────────────────────────────────────────────────────────

resource "digitalocean_ssh_key" "app" {
  name       = "mts-prod"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# SSH (22), HTTP (80), and HTTPS (443) only — everything else (the app's
# internal Postgres/Redis/Mongo/backend/frontend ports) stays behind nginx
# inside the docker-compose network and is never exposed here.
resource "digitalocean_firewall" "app" {
  name        = "mts-prod-fw"
  droplet_ids = [digitalocean_droplet.app.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

data "digitalocean_domain" "zone" {
  name = var.dns_zone
}

resource "digitalocean_record" "app" {
  domain = data.digitalocean_domain.zone.name
  type   = "A"
  name   = var.app_hostname
  value  = digitalocean_droplet.app.ipv4_address
  ttl    = 300
}

# ── Compute ──────────────────────────────────────────────────────────────────────

resource "digitalocean_droplet" "app" {
  name     = "mts-prod"
  region   = var.droplet_region
  size     = var.droplet_size
  image    = "ubuntu-24-04-x64"
  ssh_keys = [digitalocean_ssh_key.app.id]

  user_data = templatefile("${path.module}/templates/cloud-init.sh.tpl", {
    fqdn              = local.fqdn
    repo_url          = var.repo_url
    repo_branch       = var.repo_branch
    letsencrypt_email = var.letsencrypt_email
    secret_key        = random_password.app_secret_key.result
    postgres_password = random_password.postgres_password.result
    anthropic_api_key = var.anthropic_api_key
  })
}
