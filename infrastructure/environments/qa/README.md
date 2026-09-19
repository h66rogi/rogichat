# QA 독립 Terraform roots

서울 Lightsail 1대, static IP, 최소 firewall, `qa.rogi.chat`·`api.qa.rogi.chat` DNS를 소유할 위치.
Tailscale + OpenSSH를 사용하고 공개키 파일은 private ops의 승인된 commit에서 입력받는다.
AWS/Cloudflare root와 state key를 분리한다. 실제 secret이나 backend 파일을 넣지 않는다.
설계: [infrastructure-and-delivery](../../../docs/infrastructure-and-delivery.md).

- `aws`: Ubuntu 24.04 Lightsail, imported RSA public key, static IP/attachment,
  TCP 80/443와 bootstrap /32 SSH. 상시 SSH는 Tailscale 경로만 사용한다.
- `cloudflare`: 기존 zone의 `api.qa.rogi.chat` A 레코드 하나, `proxied=false`.
- 기존 공유 S3 backend를 참조하지만 state는 `rogichat/qa/aws.tfstate` 및
  `rogichat/qa/cloudflare.tfstate`로 분리한다. bucket/OIDC 자체는 재선언하지 않는다.
- Terraform 1.16.3, AWS 6.65.0, Cloudflare 5.25.0 및 provider lockfile을 고정한다.

관리 실행기에서 외부 backend/입력 파일로 init/plan한다. 실제 key/zone/IP/backend 파일을
이 공개 저장소에 넣지 않는다. public CI는 `init -backend=false`와 mock provider test만
수행한다. 사용자 프로필 인증은 bootstrap에 사용하며 자동화용 최소 권한 role은 별도 구현한다.

```sh
python3 tools/infrastructure/install.py
# 저장소 루트에서 실행. 값 파일은 관리 장비에 별도 준비한다.
.tools/terraform -chdir=infrastructure/environments/qa/aws init -backend-config=/external/aws.backend.hcl
.tools/terraform -chdir=infrastructure/environments/qa/aws plan -var-file=/external/qa.aws.tfvars.json -out=/external/qa.aws.tfplan
```

변경 plan을 검토한 뒤 같은 saved plan만 적용한다. static IP는 AWS apply 후 Cloudflare
입력으로 전달하므로 DNS plan은 별도다. 기존 레코드가 존재하면 소유권을 확인하고 import
또는 원 소유 root에서 이관하며 강제 덮어쓰기하지 않는다. 기존 zone/운영 레코드는 대상이 아니다.

key pair는 최초 접속용이다. 이후 키 추가/철회는 private ops의 전체 access 목록을 host에
reconcile하며, 키 변경을 이유로 DB host를 교체하지 않는다. `prevent_destroy`가 host 교체를
차단하고 bootstrap script 변경도 자동 재생성을 일으키지 않는다. 이후 host 변경은 명시적
reconciliation이 필요하다. Lightsail 생성 직후 provider 기본 포트가 존재할 수 있으므로
최종 firewall·host 접근 검증 전 데이터·runtime secrets를 배치하지 않는다.

최초 key는 private ops bootstrap 명세의 **고정 commit/path**에서 외부 파일로 추출한다.
활성 access manifest 변경이 최초 key-pair 입력을 자동 변경하지 않게 한다.
`access_phase=bootstrap`은 비어 있지 않은 /32 목록을 요구하고, `tailnet`은 빈 목록만
허용한다. tailnet 단계 전환은 신규 SSH 세션·재부팅 후 접속을 실증한 뒤 수행한다.
UFW에 반영된 bootstrap /32도 함께 제거해야 하며, 이후 IP 변경은 Lightsail 방화벽만
바꾸면 안 된다. user_data는 재실행되지 않으므로 host 방화벽 reconciliation을 별도로
수행한다. 정상 접근/복구 때 두 방화벽을 모두 확인한다.
