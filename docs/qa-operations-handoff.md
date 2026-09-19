# QA 앱 배포를 위한 운영 계약

2026-09-20. 앱 프로젝트·백엔드 제품 설계는 별도 세션에서 진행한다. 이 문서는 실제로
준비한 호스트/DB와 앱 세션이 맞춰야 할 배포 경계를 구분한다.

## 준비한 기반

- API DNS-only → EC2 Caddy 직접 HTTPS. `/_infra/health`는 edge 준비 상태이며 앱 health가 아니다.
- EC2 관리: SSM 복구, Tailscale 위 pinned OpenSSH. 공인 SSH는 닫혀 있다.
- Aurora MySQL private writer, 강제 TLS, 7일 백업. 계정은 `rogichatqa` DB에만 제한한다.
- `rogichat_app`: SELECT/INSERT/UPDATE/DELETE. DDL과 다른 DB 접근 거부를 실제 검증했다.
- `rogichat_migrator`: 위 권한 + CREATE/ALTER/DROP/INDEX/REFERENCES, QA DB 범위만.
  CREATE DATABASE·mysql 시스템 테이블 접근은 거부한다. trigger/view/routine 등은
  제품 migration 요구를 검토한 뒤 별도 최소 권한 변경으로 추가한다.
- 관리자 암호는 RDS가 관리한다. runtime/migration 암호는 별도 Secrets Manager에 보관하며
  Terraform에는 secret 메타데이터와 제한된 IAM 정책만 있다. 실제 값은 state/Git에 없다.
- EC2 role로 runtime secret 읽기만 허용한다. migration·관리자 secret은 앱 호스트 역할에
  제공하지 않는다. 초기 계정 생성은 인증된 운영자가 SSH stdin으로 전달한 값으로 수행했다.

## 앱의 DB 연결 입력

호스트의 `rogichat-runtime-secrets.service`가 인스턴스 역할로 runtime secret을 읽고
`/run/rogichat/secrets/database.json`에 원자적으로 기록한다. `/run`은 tmpfs이며 파일은
root:GID 10001, `0440`이다. 비밀 원문을 stdout·systemd log·docker inspect 환경변수에
넣지 않는다. 서비스 스크립트는 root 소유이며 ops/source push로 자동 교체하지 않는다.

앱 Compose는 이 파일을 `/run/secrets/database.json:ro`로 mount하고 GID 10001로 읽도록
구성한다. CA bundle `/etc/rogichat/rds-global-bundle.pem`도 읽기 전용 mount한다.
JSON 필드는 `host`, `port`, `database`, `username`, `password`이며 앱은 시작 때 읽고
DB client에 전달한다. `ssl verify CA + hostname`이 필수다. TLS verify를 끄지 않는다.
앱의 최종 container UID/GID·driver 연결 코드는 해당 앱 세션이 이 계약에 맞춰 검증한다.

원자적 파일 교체만으로 기존 file bind mount가 새 암호를 읽는 것은 아니다. 암호 회전은
DB 사용자 변경·Secrets Manager 버전·호스트 파일·앱 recreate·연결 검증을 묶어 수행한다.
현재 runtime/migration 자동 rotation은 켜지 않았다. 재실행 bootstrap으로 비밀번호를
몰래 바꾸지 않도록 `provision_database.py`는 기존 계정이 있으면 거부한다.

호스트 재생성 시 distro `python3-pymysql`, `python3-boto3`와 AWS RDS CA bundle을
설치하고, 승인된 source SHA의 `tools/operations/fetch_runtime_secret.py`를
`/opt/rogichat/operations/`에 root 전용으로 배치한다. 제공한 systemd unit을 설치한 뒤
`systemctl enable --now rogichat-runtime-secrets.service`를 실행한다. 앱 배포 unit은
이 unit에 `Requires=`·`After=`를 선언해야 한다. 단순한 Docker restart 정책만으로
재부팅 때 tmpfs secret보다 앱이 먼저 시작하지 않도록 순서를 검증한다.

## 앱별 배포와 migration

public hosted CI는 검증·빌드/GHCR digest 발행, private ops는 서비스별 source SHA와
image digest를 요청하는 구조다. cloud/SSH secret을 public job에 주지 않는다.
registry token이 있는 단계에서 비신뢰 PR install/build를 실행하지 않는다.

외부 실행기는 서버 소유 승인 정책을 통과한 **서비스별 immutable digest**만 적용하고
host 공통 잠금으로 compose 변경을 직렬화해야 한다. 웹과 API를 별도 요청·rollback하며
각각 health/readiness·공개 경로를 검증한다. 새 이미지 불건전 시 이전 digest로 복귀한다.
DB destructive down migration은 rollback에 포함하지 않는다.

migration은 승인된 단일 job만 별도 migration secret으로 실행한다. API startup마다
자동 DDL을 실행하지 않는다. 앱 runtime에는 migration 암호를 mount하지 않는다.
Prisma `migrate dev`의 shadow DB 생성 권한은 QA 배포 계정에 주지 않는다. 제품 schema와
migration 파일은 백엔드 세션 소유이며 인프라 작업이 대신 생성하지 않는다.

**아직 미완료:** 최종 앱 image·port·health 계약, 실제 서비스별 publisher/deployer,
Atlantis 인가기·격리 worker·GitHub App·webhook. 위 요구를 문서화한 것으로 작동하는
자동 배포가 생겼다고 보고하지 않는다. 앱 artifact가 준비되면 각 경로를 실제로 검증한다.

## 복구

[별도 restore-drill root](../infrastructure/environments/qa/restore-drill/README.md)는 기본 비활성이다.
정확한 복구시점에 임시 private cluster/writer 두 개를 만들고 합성 marker와 TLS 접속을
검증한 뒤 삭제한다. 원본 DB·앱 DNS는 바꾸지 않는다. full-copy 완료시간과 백업 lag는
제품 RTO/RPO 보증과 구분한다. 실제 데이터량과 앱 복구를 포함한 시험은 출시 전 필요하다.
