# Production foundation preparation

운영 주소는 `rogi.chat`, API는 `api.rogi.chat`이다. 모든 준비 코드는 먼저 QA PR의
필수 검사를 거친다. 이 디렉터리 추가나 QA 병합은 운영 자원 생성 또는 서비스 공개를
실행하지 않는다. 실제 적용은 private ops의 고정 source SHA와 별도 saved plan을 따른다.

## Initial capacity and separation

- 서울 EC2 `t3a.medium` 1대, 암호화 gp3 80 GiB, EIP 1개.
- 별도 private Aurora MySQL `db.r8g.large` writer 1대. 소유자가 기존에 보유한
  큰 예약 규격 활용을 선택했다. 새 RI 구매는 하지 않는다.
- QA와 다른 VPC/subnets, DB/schema, IAM instance role, runtime/migration secret,
  state key/lock, Tailnet 장비를 사용한다. 같은 운영자 공개키는 private ops의 불변
  Git blob으로 참조하며 공개 저장소에 복사하지 않는다.
- 백업 14일, TLS 강제, DB 암호화·삭제 보호·최종 snapshot 필수. EC2 종료 보호와
  root disk 보존을 적용한다. 앱 역할은 운영 runtime secret 하나만 읽을 수 있다.
- 단일 앱 호스트와 단일 DB writer다. 다중 AZ 저장소가 앱/DB compute의 고가용성을
  의미하지 않는다. 장애 시 복구 및 중단 시간이 발생할 수 있다.

## Roots

| Root | Scope | External backend key |
| --- | --- | --- |
| `aws-ec2` | Dedicated production network, host, database, IAM and empty secret containers | `rogichat/prod/aws-ec2.tfstate` |
| `cloudflare` | Only apex/API records, disabled by default | `rogichat/prod/cloudflare.tfstate` |
| `runtime` | Production bootstrap edge assets; staged without startup | Not a Terraform root |

Bucket/account/backend/zone identifiers, approved key path and plan files remain outside
public Git. Use an isolated absolute `TF_DATA_DIR` for each prod root and S3 lockfile locking.
Never re-use QA backend configuration or migrate/import QA state. The AWS provider requires
an explicit approved account. Before first apply, verify production names/CIDRs are unused,
backend versioning/encryption/public blocking and a create-only plan with no QA changes.

`aws-ec2` deliberately leaves existing QA Terraform addresses and resources unchanged.
It reuses the audited host bootstrap template while supplying production-only Compose/Caddy.
Converting the already-live QA root into a module requires its own state-migration review;
it is not bundled into this production preparation.

## Publication and execution gates

`publish_dns=false` is the default and yields zero DNS resources. Only a separately reviewed
cutover may enable exactly `rogi.chat` and `api.rogi.chat`, DNS-only, with direct Caddy HTTPS.
Do not import/take over pre-existing records without reviewing their ownership. DNS records
have `prevent_destroy`; turning the flag off after cutover is deliberately not a rollback.
Caddy is not started at bootstrap; no certificates are requested until the host and DNS are ready.
The bootstrap serves maintenance responses, not the product. It does not expose host keys.

No public runner receives cloud credentials. Existing Atlantis QA allowlists and disabled
plan/apply remain unchanged. GitHub Free private approval gates are not an execution boundary.
The shared Cloudflare zone token is inherently zone-wide: QA DNS automation still needs a
record-restricted broker and must never gain production record access.

## Before product activation

1. Review exact saved plans, incremental costs and existing reservation matching, then apply
   through the approved operator identity. Verify resource identity and a clean follow-up plan.
2. Verify SSM/cloud-init; join a separate `rogichat-prod` Tailnet device using
   `--accept-dns=false --accept-routes=false --ssh=false`. Pin the host key through SSM,
   verify fresh SSH with the approved operator identity, then verify a reboot.
3. Add production-aware access reconciliation bound to an approved host inventory and SHA.
   Current private `reconcile_access.py` compiles QA keys and accepts an arbitrary host;
   do not point it at production. Bootstrap-key reuse does not authorize key reconciliation.
4. Implement and review production DB account/secret delivery and migration/release tooling.
   Existing `provision_database.py`, `fetch_runtime_secret.py`, `migrate_entry.mjs`,
   `backend_release.py` and application Compose/Caddy are QA-specific. Keep their guards.
   Terraform environment is `prod`; the application uses `APP_ENV=production`.
5. Establish backup restore evidence, recovery objectives, host/disk/cert/DB alerts and
   budget/notification destinations. Root-disk retention alone is not a backup policy.
6. Promote individually verified application image digests, validate production OAuth broker
   callback/allowed origins, web push credentials and mobile environment boundaries, then
   approve DNS/public entry. Preparation must not publish unfinished app routes.

## Verification

Credential-free CI validates both roots, including negative DB class/DNS target cases,
least-privilege secret access, no public SSH/DB, production asset selection and dormant Caddy.
Terraform and providers retain the reviewed exact versions and checksum locks used by QA.

References: [Aurora availability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html),
[S3 backend locking](https://developer.hashicorp.com/terraform/language/backend/s3).
