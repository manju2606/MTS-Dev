variable "tenancy_ocid" {
  description = "OCI tenancy OCID (Profile menu → Tenancy: <name>)"
  type        = string
}

variable "user_ocid" {
  description = "OCI user OCID (Profile menu → My profile)"
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the API signing key added under My profile → API keys"
  type        = string
}

variable "private_key_path" {
  description = "Path to the private key of the API signing key (NOT your SSH key)"
  type        = string
}

variable "region" {
  description = "OCI region, e.g. us-ashburn-1 — must match the Home Region you picked at signup"
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment to create resources in — the tenancy OCID works fine for a single-app setup"
  type        = string
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key that will be allowed to log into the instance"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "instance_display_name" {
  description = "Name shown in the OCI console for this instance"
  type        = string
  default     = "mts-prod"
}

variable "instance_ocpus" {
  description = "Ampere A1 OCPUs — Always Free covers up to 4 total across all A1 instances"
  type        = number
  default     = 4
}

variable "instance_memory_gb" {
  description = "Ampere A1 memory in GB — Always Free covers up to 24GB total across all A1 instances"
  type        = number
  default     = 24
}
