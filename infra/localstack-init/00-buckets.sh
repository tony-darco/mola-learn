#!/bin/sh
# Three-bucket upload pattern (§12). The scanner is the only component
# permitted to move objects between them; nothing downstream reads RAW.
set -e
for b in mola-raw mola-safe mola-quarantine; do
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
