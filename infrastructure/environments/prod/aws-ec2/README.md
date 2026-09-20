# Production EC2 and Aurora

Read [production preparation and activation gates](../README.md) first.
This root creates an isolated single-host/single-writer foundation in Seoul.
Explicit private `aws_account_id` and `ssh_public_key_path` inputs are required.
The operator key must be extracted from the approved immutable private Git blob.
No password value, migration, product schema, DNS change or application deployment is managed here.

The reviewed initial class is `db.r8g.large` with Aurora Standard provisioned billing.
Changing it to Serverless, I/O-Optimized or another size requires renewed reservation/cost review.
Managed administrator credentials and empty runtime/migration secret containers remain distinct.
The host gets only its runtime secret ARN. Secret values and DB users are a later approved operation.

Keep the saved plan and backend outside Git, tied to the exact public source and private ops SHAs.
Use the independent production backend and TF_DATA_DIR. Apply only the reviewed saved plan.
The staged Caddy assets do not start until separately reviewed DNS activation.
