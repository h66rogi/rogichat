# QA EC2 / Aurora MySQL 전환

2026-09-20: 사용자 승인으로 QA 앱 서버를 EC2로 전환하고 DB를 PostgreSQL에서
MySQL 계열로 변경한다. 아래 사양과 신규 28개 plan은 사용자 비용 승인 후 생성 완료했다.
신규 자원 생성·DNS 전환·기존 Lightsail 삭제는 각각 실제 적용 상태로 구분한다.

## 제안 구성

- 서울 전용 VPC. 앱 public subnet 1개, DB private subnet 2개(A/C AZ), DB 인터넷 route 없음.
- EC2 `t3a.medium`(x86_64, 2 vCPU, 4 GiB), Ubuntu 24.04, 암호화 gp3 80 GiB, EIP 1개.
  CPU credit Standard로 추가 CPU credit 과금 대신 baseline 제한을 선택한다.
- public inbound는 80/443뿐이다. SSM을 먼저 사용하며 Tailscale 위 OpenSSH를 유지한다.
  EC2 role은 SSM managed-node 권한만 갖고 Aurora 관리자 secret은 읽지 못한다.
  IMDSv2 필수, hop limit 1로 앱 컨테이너의 instance-role 자격증명 접근을 제한한다.
- Aurora MySQL `8.0.mysql_aurora.3.10.3`, provisioned `db.t4g.medium` writer 1개,
  Aurora Standard. RDS API에서 서울 해당 조합의 생성 가능 여부를 확인했다.
  RI는 엔진·리전·class family 등이 맞아야 하며 Serverless를 대신 선택하지 않는다.
- DB는 비공개, 앱 SG에서만 3306 허용, TLS 필수, 저장 암호화, 백업 7일/PITR,
  deletion protection·Terraform prevent_destroy·final snapshot 필수.
  관리자 암호는 RDS가 Secrets Manager에서 관리하며 Terraform 변수/state에 암호를 넣지 않는다.
  앱 전용 최소 권한 DB 계정과 secret 전달은 앱 배포 전에 별도로 구성한다.
- writer 한 대라 즉시 승격할 reader는 없다. 다중 AZ 스토리지 내구성을 DB compute HA로
  해석하지 않는다. QA 기준이며 운영의 reader/복구 목표는 별도 결정한다.
- NAT Gateway·ALB는 초기 QA에 추가하지 않는다. 앱 서버가 공인 IP로 SSM/패키지/
  GHCR/Tailscale에 outbound 연결한다. DB는 인터넷 연결이 필요 없다.

Lightsail의 관리형 VPC peering은 같은 리전의 default VPC를 대상으로 한다. Aurora와
앱을 직접 같은 전용 VPC에 배치하면 이 제약과 별도 peering 의존성이 없어진다.
[Lightsail VPC peering](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-set-up-vpc-peering-with-aws-resources.html).

## 비용 검토

AWS Pricing API에서 조회한 서울 Linux On-Demand 기준, 월 730시간 가정:

| 항목 | 월 환산 USD |
|---|---:|
| EC2 t3a.medium (0.0468/시간) | 34.164 |
| gp3 80 GiB (0.0912/GiB-month) | 7.296 |
| 공인 IPv4 1개 (0.005/시간) | 3.650 |
| 앱 서버 기본 합계 | 45.110 |
| Aurora t4g.medium Standard, RI 적용 전 (0.113/시간) | 82.490 |

EC2 RI/Savings Plans와 Aurora RI는 서로 다른 할인이다. 계정 내 예약 목록과 조직
전체 실제 할인 사용률도 구분한다. 실제 보유 예약 상세는 private ops에만 기록한다.
RI를 이미 구매했더라도 신규 DB의 증분 compute 비용이 0이라고 단정하지 않는다.
리전·엔진·family 일치와 조직의 RI 사용 현황을 확인해야 한다.
[RI 적용 조건](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_WorkingWithReservedDBInstances.html).

Aurora storage/I/O/backup 초과, Secrets Manager, 트래픽, 세금과 짧은 서버 공존 비용은
위 합계에서 제외한다. Aurora burstable class는 Unlimited여서 baseline 초과 사용에
CPU credit 요금이 생길 수 있다. DB RI는 이 비용까지 무료로 만들지 않는다.
[DB class/CPU credit](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.DBInstanceClass.Types.html),
[공인 IPv4 가격](https://aws.amazon.com/vpc/pricing/).

## 적용과 전환 순서

1. `aws-ec2` 독립 root/state의 신규 자원 plan을 검토·승인 후 적용한다. 기존 Lightsail,
   Cloudflare root/state와 기존 backend bucket은 변경하지 않는다.
2. EC2 SSM Online, cloud-init 성공, UFW/SSHD/Docker/Tailscale, 암호화·SG·DB TLS를
   실서버에서 검증한다. SSM에서 호스트 키를 읽어 SSH trust를 pin한다.
3. bootstrap은 Caddy 파일만 준비하고 시작하지 않는다. 아직 DNS가 Lightsail을
   가리킬 때 새 호스트에서 ACME 요청을 반복하지 않는다.
4. 승인된 Cloudflare plan으로 API A 레코드를 EC2 EIP로 변경한 뒤 Caddy를 시작한다.
   DNS 전파·인증서 SAN/chain·HTTPS health와 새 컨테이너 digest를 외부에서 검증한다.
5. 웹/API/DB 실제 앱 smoke test와 Tailscale 접근을 확인한다. 최초 공개키 목록은
   private ops 승인 SHA로 reconcile하며 개인키는 GitHub 밖에 둔다.
6. 검증 후 기존 Lightsail 5개 자원의 별도 destroy plan을 검토한다. 인스턴스를 단순히
   stop하면 비용 정리가 끝났다고 볼 수 없으므로 승인된 삭제와 실제 청구 자원 제거를 확인한다.

## 2026-09-20 생성·검증 결과

- 신규 28개 자원 apply 완료, 적용 후 전체 plan 변경 0건.
- EC2 SSM Online, EIP 연결, 암호화 gp3 80 GiB, IMDSv2/hop limit 1, public ingress
  80/443만 확인했다. Docker·SSHD·tailscaled가 active이고 Caddy 이미지 버전을 검증했다.
- SSM 경유 최초 호스트 키를 pin하고 Tailscale 등록·운영자 키 인증을 완료했다.
  private ops 공개키 목록 적용 후 새 인증 연결과 재검사 일치를 확인했고 재부팅 후에도
  host key와 SSH 인증·네 서비스 자동 기동을 검증했다.
- Aurora writer available, private, 암호화/삭제 보호/백업 7일, TLS-required parameter
  in-sync. EC2에서 실제 MySQL TLS 1.3 연결·CA·hostname 검증을 통과했다.
  앱 전용 DB 사용자·schema migration·SQL 제품 동작은 아직 구현 전이다.
- 최초 EC2 bootstrap에서 `/run/sshd`가 없어 SSH 검사 단계가 실패했다. 디렉터리와
  서비스 초기화를 소스에 추가하고 SSM으로 동일 호스트에 reconcile했다.
  최초 cloud-init 오류 이력은 보존했고 성공으로 덮어쓰지 않았다.
- Tailnet의 RDS split-DNS와 새 VPC의 DB 이름 해석이 충돌했다. EC2는
  `--accept-dns=false --accept-routes=false --ssh=false`로 자체 VPC DNS를 사용한다.
  Tailscale은 관리 연결을 제공하고 OpenSSH는 승인된 공개키를 검증한다.
  전역 Tailnet DNS는 변경하지 않았다. 향후 이 호스트의 다른 사설 이름 의존성은 별도 검토한다.
- API DNS는 기존 Lightsail을 계속 가리킨다. 새 EC2의 Caddy는 DNS 전환 전 staged 상태이며
  기존 Lightsail은 정상 HTTPS를 제공한다. 새 서비스 경로 전환이나 기존 서버 삭제는 미실행이다.

