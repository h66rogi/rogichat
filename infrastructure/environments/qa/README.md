# QA 독립 Terraform roots

서울 EC2 앱 호스트와 private Aurora MySQL, Cloudflare DNS를 별도 state로 관리한다.
OpenSSH는 Tailscale 경로만 사용한다. 승인된 공개키는 private ops의 고정 commit에서
외부 파일로 추출한다. 개인키·실제 입력·backend·state·plan은 Git 밖에 둔다.

- `aws-ec2`: 전용 VPC, EC2, SSM, EIP, private Aurora MySQL.
- `cloudflare`: 기존 zone의 `api.qa.rogi.chat` A 레코드 하나, DNS-only.
- `aws`: 퇴역한 Lightsail의 빈 root. 기존 state 확인용이며 활성 배포 대상이 아니다.
- 기존 공유 S3 bucket을 재사용하되 각 root의 `rogichat/qa/<root>.tfstate`로 분리한다.
  bucket 자체나 다른 프로젝트 자원은 소유하지 않는다.
- Terraform 1.16.3, AWS 6.65.0, Cloudflare 5.25.0과 provider lockfile을 고정한다.

```sh
python3 tools/infrastructure/install.py
.tools/terraform -chdir=infrastructure/environments/qa/aws-ec2 init -backend-config=/external/aws-ec2.backend.hcl
.tools/terraform -chdir=infrastructure/environments/qa/aws-ec2 plan -var-file=/external/qa.aws-ec2.tfvars.json -out=/external/qa.aws-ec2.tfplan
```

정확한 plan을 검토·승인한 뒤 같은 saved plan만 적용한다. EC2와 DB에는 삭제 보호가
있으며 bootstrap 변경은 호스트를 자동 교체하지 않는다. 명시적 reconciliation과
재부팅 후 검증이 필요하다. DNS 전환은 Cloudflare root의 별도 plan으로 검토한다.

공개 CI는 cloud credential 없이 provider mock과 템플릿을 검증한다. private ops의
push도 실제 적용 승인을 대신하지 않는다. [배포 경계](../../../docs/repository-isolation.md).
