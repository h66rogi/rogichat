# Atlantis 실행 경계

**아직 연결하지 않은 설계**다. public PR의 Terraform은 plan만으로도 코드를 실행할 수 있다.
apply 승인만으로 credential 유출을 막지 못한다.
[공식 보안 설명](https://www.runatlantis.io/docs/security).

## 우선안: 별도 비공개 실행 경로

IaC의 원본은 이 public monorepo에 유지한다. 관리 영역의 작은 private 실행 저장소는
검토된 rogichat commit SHA와 실행 환경만 선택한다. 자동으로 외부 PR head를 전달하지
않는다. IaC를 복제해 별도 수정하는 두 번째 source of truth를 만들지 않는다.
운영자 review 뒤 고정 SHA의 root를 검증·실행하며 변경 diff와 plan은 관리 영역에만 남긴다.
이 실행 저장소/호스트는 현재 생성하지 않았고 사용자가 함께 검토할 결정 사항이다.

전용 GitHub App과 AWS role, zone 한정 Cloudflare token을 사용한다. 앱/DB 호스트와
같은 secret volume이나 Docker socket을 공유하지 않는다. AWS prod 역할은 QA 실행기에
제공하지 않는다. 기존 Atlantis가 발견되면 배포 방식·접근 제어를 확인한 뒤 재사용한다.

## 공개 저장소 직접 연결 대안의 필수 조건

직접 연결을 선택한다면 webhook 활성화 전에 아래를 실제 설정과 공격 테스트로 검증한다.

1. 정확한 repo allowlist, `allow-fork-prs=false`, automatic plan 비활성화.
2. HTTPS webhook secret 검증, 허가된 operator만 plan/apply 명령 실행.
3. server-side config만 workflow 소유. repository override/custom workflow 불허.
4. 승인된 최신 head SHA만 plan. plan 후 commit 변경 시 기존 승인·plan 무효화.
5. init 이전 provider/module source allowlist와 lockfile 검증. 임의 `external`,
   `local-exec`, 다운로드/실행 hook 금지. 필요한 API 외 egress를 제한.
6. plan/apply/import에 review·mergeable·undiverged 조건. 임의 디렉터리/var-file
   인자로 다른 프로젝트/서버 비밀을 읽을 수 없게 project·path 경계 검증.
7. public PR 댓글/실시간 로그/artifact에 plan 원문과 민감 출력을 게시하지 않음.
   단순 민감 표시만으로 충분하지 않으므로 정확한 output 정책을 먼저 구현·시험.
8. 잠금·단일 apply, 서버 UI 인증, plan 저장소 암호화/TTL, 감사 기록.

승인자가 한 명이면 GitHub에서 자기 PR 승인을 만들 수 없다. 이 경우 approval 조건을
몰래 제거하지 않고 비공개 관리 영역의 별도 명시적 실행 승인 절차를 설계한다.
예제 설정 파일만으로 이 보안 경계가 적용됐다고 보고하지 않는다.

이 설계는 [서버 설정](https://www.runatlantis.io/docs/server-configuration)과
[서버 측 저장소 설정](https://www.runatlantis.io/docs/server-side-repo-config)을 기준으로
설치 버전에서 다시 검증한다. 현재 live Atlantis와 webhook이 없어 Terraform 실행은 발생하지 않는다.
