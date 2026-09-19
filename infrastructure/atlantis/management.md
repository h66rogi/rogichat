# 별도 관리 EC2 제안

상태: 2026-09-20. 사용자가 사양·비용·신규 15개 자원 plan을 승인하여 **관리 호스트 생성 완료**.
GitHub App을 private ops 한 곳에 설치했다. [version-only 수신 경로](runtime/README.md)는 구현·검증 중이며 공개 ingress·권한 있는 worker는 아직 활성화하지 않았다.

## 사양과 비용

서울 `t3a.small` (2 vCPU / RAM 2 GiB), Ubuntu 24.04, 암호화 gp3 30 GiB,
공인 IPv4 하나를 초기 관리 호스트로 제안한다. 앱 빌드는 GitHub-hosted runner에서 한다.
아래 월 환산은 730시간이며 할인·세금·트래픽·백업·Secrets Manager는 제외한다.

| 항목 | 확인 단가 | 월 환산 |
|---|---|---|
| EC2 t3a.small Linux | US$0.0234/시간 | US$17.08 |
| gp3 30 GiB | US$0.0912/GiB·월 | US$2.74 |
| 공인 IPv4 1개 | US$0.005/시간 | US$3.65 |
| 합계 | | **약 US$23.47/월** |

EC2 단가는 AWS Price List API의 서울·Linux·Shared OnDemand 결과로 확인했다.
CPU credits는 Standard로 제한한다. CPU 제한이 생기면 실행 시간이 늘어날 수 있다.
계정 소유 활성 EC2 RI/Savings Plans는 확인되지 않았다. 조직 할인 배분은 미확인이다.

2 GiB는 초기 관리 서비스 후보 사양이지 Terraform의 충분한 메모리를 보증하는 값이 아니다.
plan/apply 동시 실행은 1개부터 시작하고 실제 peak RSS·OOM을 계측한다. GitHub App
credential을 가진 수신기와 Terraform worker는 별도 실행 경계가 필요하다. 모든 작업을
이 작은 호스트의 일반 Docker 컨테이너에 몰아넣고 격리가 해결됐다고 간주하지 않는다.
일회성 EC2 worker를 택하면 실행 시간에 따른 별도 비용이 생긴다. 초기 검증 단계에는
현재 승인된 관리 장비의 saved-plan 적용 경로를 유지해 미검증 worker에 권한을 주지 않는다.

## 승인·생성한 15개 자원의 범위

[management/aws](../environments/management/aws/README.md)는 전용 VPC·subnet·internet
route·SG, SSM agent용 IAM role/profile, 공개키, EC2, EIP/연결을 만든다.
앱 VPC와 peering이 없고 DB SG도 변경하지 않는다. 공인 ingress는 0개다.
SSH는 Tailscale, 가입 전 복구는 SSM을 사용한다. EC2 role에는 Terraform apply,
Secrets Manager 읽기, 다른 호스트에 SSM command를 실행하는 권한이 없다.

이 단계의 공인 IPv4는 패키지 설치·SSM·Tailscale의 outbound 통신용이다. 외부 webhook
수신을 아직 열지 않는다. 별도 호스트 생성을 Atlantis 자동화 완료로 보고하지 않는다.

## Atlantis 활성화 순서

1. **완료:** 사용자 승인 후 호스트 생성, SSM host key pin, Tailnet 가입, private ops 공개키 적용,
   새 SSH 인증·재부팅 복구를 검증했다. operator 개인키는 관리 EC2에 복제하지 않았다.
2. GitHub App을 **private h66rogi/rogichat-ops 한 곳**에 설치한다. 공개 소스는 immutable
   SHA로 읽으며 public PR/comment를 Atlantis에 연결하지 않는다. App private key와
   webhook secret은 GitHub Git/Secrets/log/artifact 밖의 암호화 저장소에 둔다.
3. 서버 소유 정책으로 정확한 repo·qa·root·ops/source SHA를 제한한다. fork/autoplan/
   automerge/임의 workflow·extra args를 차단한다. repo config override도 허용하지 않는다.
4. GitHub Free private의 mergeability·CODEOWNERS·branch 이름은 승인 증거가 아니다.
   plan 전에 GitHub 밖에서 인증된 운영자의 SHA 승인을 검증한다. apply에는 그에 더해
   exact saved-plan digest·state lineage/serial·만료시각·재사용 방지 검증이 필요하다.
   서버 정책 변경은 ops push로 자동 적용하지 않는다.
5. init부터 코드가 실행된다는 전제로 provider/module·symlink·hook을 검증한다.
   App credential·SSH key와 격리된 worker에 QA 전용 최소 cloud 권한만 발급한다.
   IAM/backend 변경은 별도 bootstrap 영역이며 관리 서버가 자기 권한을 확대하면 안 된다.
   Cloudflare zone token은 QA/prod 레코드를 권한상 나누지 못하므로 별도 변경 중개기가
   허용된 QA record만 수정해야 한다. 이 경계 검증 전 DNS 자동 apply는 꺼둔다.
6. UI·plan·전체 로그는 관리망에서만 제공한다. 외부에는 HTTPS `/events` 수신기만
   별도 검토 후 노출하고 HMAC·delivery 재사용을 검증한다. GitHub에는 고정 상태와
   change count만 반환한다. Terraform 원문은 private repo에도 게시하지 않는다.
7. 위조 이벤트, 승인 후 push·재plan, 만료·재사용, 동시 apply, 악성 HCL, secret 출력,
   app/DB/metadata 접근, 승인자 권한 회수 시험 후 단계별로 활성화한다.

현재 구현은 관리 호스트 IaC, 최소 권한 GitHub App, version-only gateway/서버 설정과
승인·재전송 방지 단위 테스트까지다. 실제 plan/apply 인가기 연결과 격리 worker는 미구현이다.
공개 HTTPS 연결은 AWS ingress 2개와 별도 management Cloudflare record 1개의
저장 plan을 검증한 후 적용한다. 기존 자원 변경·삭제 및 추가 상시 컴퓨팅은 없다.
작은 EC2 한 대를 만드는 것과 안전한 자동화 경계를 완성하는 일은 별도로 검증한다.

근거: [Atlantis security](https://www.runatlantis.io/docs/security),
[server-side repo config](https://www.runatlantis.io/docs/server-side-repo-config).
공식 문서를 Context7와 원문으로 대조했다. 승인만 apply에 걸어두면 plan 단계의 임의 코드
실행을 막지 못한다는 제약을 반영했다.
