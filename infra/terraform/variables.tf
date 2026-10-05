variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  description = "Name suffix for this stack (dev | prod). Separate state key per environment."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "web_origins" {
  description = "Origins allowed to PUT/GET against the upload buckets (browser pre-signed uploads)."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "GB. Free tier covers 20."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}
