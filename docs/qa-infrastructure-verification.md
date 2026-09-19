# QA 기반 검증 기록

2026-09-20. 제품 앱 배포와 구분한 실제 인프라 검증 결과다. 실제 주소·ID·SSH 키·plan·
원문 로그는 private ops 또는 Git 밖 관리 저장소에 보관한다.

| 검증 항목 | 결과 |
|---|---|
| API DNS 전환 | DNS-only A 1건을 EC2로 변경, 권한 DNS와 외부 resolver 확인 |
| Caddy HTTPS | 새 EC2 공개 CA·hostname 검증, HTTP 200; 재부팅 후도 정상 |
| Lightsail 퇴역 | TTL 300초 경과 후 5개 자원 삭제, AWS에서 instance/IP 부재·빈 state plan 확인 |
| 앱 EC2 접근 | SSM host key pin, Tailnet OpenSSH 새 인증, public SSH 차단, 공개키 목록 일치 |
| 관리 EC2 | 승인된 신규 15개 자원 생성, 첫 cloud-init 정상, 공인 ingress는 별도 승인한 TCP 80/443만, SSM role만 |
| 관리 EC2 복구 | 사용자 Tailnet 가입, 공개키 적용, 새 SSH·재부팅·반복 drift 검증 |
| DB runtime | QA CRUD 가능, DDL·다른 DB 접근 거부, CA/hostname TLS 검증 |
| DB migration | QA DDL 가능, CREATE DATABASE·mysql 시스템 테이블 접근 거부 |
| Secret 권한 | 앱 instance role로 runtime 읽기 성공, migration/admin은 실제 API AccessDenied |
| Secret 보관 | 비밀번호 Git/state 없음, runtime만 tmpfs root:10001 0440에 전달 |
| 재부팅 후 DB | tmpfs secret 재생성, runtime 인증·TLS 쿼리 성공 |
| 잘못된 대상 | QA 운영 도구에 prod 형태 hostname 입력 시 연결 전 거부, 입력 원문 출력 없음 |
| Terraform 정합성 | AWS 앱·Cloudflare·management 후속 전체 plan 변경 0 |
| 공개 CI | secret 검사, mock Terraform·Caddy·Compose 검증 성공; cloud credential 없음 |

## Aurora point-in-time recovery 시험

원본 QA에 합성 marker 1행을 넣고 `LatestRestorableTime`이 해당 commit을 포함할 때까지
기다렸다. 별도 state에서 정확한 UTC 시점으로 임시 private cluster + writer를 복원했다.
원본 subnet/SG와 TLS parameter group을 명시하고 원본 DB·앱 DNS·앱 credential은 바꾸지 않았다.

- 복원 apply 완료: **431초**.
- 복원 시작부터 CA/hostname 검증·runtime 로그인·marker 일치 조회 완료: **463초 (7분 43초)**.
- 사용한 복구시점은 복원 시작 기준 **180초 전**이었다. 이는 이 시험의 관측값이다.
- 원본의 합성 시험 테이블은 marker 일치를 확인한 뒤 제거했다.
- 임시 자원 2개를 삭제했다. AWS API에서 writer/cluster 부재와 빈 state의 후속 plan 변경 0건을 확인했다.

이 수치는 작은 시험 DB 기준이며 실제 제품 데이터량·migration·DNS 전환·앱 재기동까지
포함한 RTO/RPO 보증이 아니다. 현재 원본은 7일 백업과 writer 1개이며 failover reader는 없다.
제품 출시 전 실제 데이터·앱을 포함한 복구 절차를 다시 검증한다.

## 아직 활성화하지 않은 범위

- Atlantis 서버 소유 승인기의 실행 연결, 격리 worker와 QA 한정 apply 권한.
  GitHub App과 Caddy HTTPS webhook 연결은 완료했으며 현재는 고정 status 응답만 허용한다.
- 앱별 image publisher/deployer와 실서비스 health·rollback 검증. 앱 프로젝트 세션과 연결한다.
- Tailnet 장기 tag/grant·key expiry 정책, 조직 RI 할인 배분 확인.

관리 EC2가 있다고 Atlantis 자동 적용이 동작하는 것은 아니다. Free private의 push/merge를
승인 경계로 쓰지 않으며, 위 경계 검증 전에는 현재의 운영자 승인 saved-plan 경로를 유지한다.
