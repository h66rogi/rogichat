# QA EC2 / Aurora MySQL 전환

2026-09-20: 사용자 승인으로 QA 앱 서버를 EC2로 전환하고 DB를 PostgreSQL에서
MySQL 계열로 변경한다. 아래 사양과 실제 Terraform plan은 적용 전 비용 검토 대상이다.
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

현재는 사용자 결정에 따른 IaC/plan 준비 단계다. 이 문서가 EC2/Aurora 배포 완료 증거는 아니다.
