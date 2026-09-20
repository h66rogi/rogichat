# Management worker canary root

Separate S3 state key: `rogichat/management/worker.tfstate`. Supply real bucket
name and probe target addresses using an external, private var file. Keep backend
config, saved plan, plan JSON and logs outside Git. The generated reaper zip is
under ignored `.terraform/build`; it contains only the fixed public reaper source.

This root creates a launch template, **not an EC2 instance**. After an explicitly
approved saved-plan apply, record the live template/version/configuration digest
and reaper code digest in private ops, then use its approved canary launcher.
Do not give the management instance RunInstances, PassRole or Terraform rights.

See [architecture, diagnostics and remaining gates](../../../atlantis/worker/README.md).
Tests use mock AWS resources and fixture inputs; CI receives no cloud credentials.
