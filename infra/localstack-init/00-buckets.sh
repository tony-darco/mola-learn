#!/bin/sh
# Three-bucket upload pattern (§12). The scanner is the only component
# permitted to move objects between them; nothing downstream reads RAW.
set -e
for b in mola-raw mola-safe mola-quarantine mola-canvas; do
  awslocal s3 mb "s3://$b" 2>/dev/null || true
done
awslocal s3api put-bucket-cors --bucket mola-raw --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedOrigins": ["http://localhost:3000"],
    "ExposeHeaders": ["ETag"]
  }]
}'

# Canvas images are uploaded via a pre-signed PUT (same shape as mola-raw)
# but, unlike course documents, are meant to render back with a plain,
# non-expiring <img src> URL for as long as the canvas exists — so this
# bucket also gets anonymous GET, which mola-raw deliberately does not have.
awslocal s3api put-bucket-cors --bucket mola-canvas --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedOrigins": ["http://localhost:3000"],
    "ExposeHeaders": ["ETag"]
  }]
}'
awslocal s3api put-bucket-policy --bucket mola-canvas --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadCanvasImages",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::mola-canvas/*"
  }]
}'
