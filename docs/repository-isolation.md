# 공개 소스와 비공개 운영 저장소

상태: 2026-09-19 사용자 승인으로 `h66rogi/rogichat-ops` private 저장소를 생성했다.
공개키 GitOps 예외도 승인됐다. 상시 Atlantis·배포 실행기의 배치는 추가 설명 후 논의 중이다.
GitHub 조직의 Free 플랜을 확인했다. 실제 권한 있는 실행과 Atlantis 연결은 별도 구현·검증 대상이다.

## 공개 범위와 소유권

**공개 앱 소스·재현 가능한 빌드·일반 IaC는 유지하고, 실제 운영 입력과 적용 권한을 분리한다.**
CI 설정이 공개된 것 자체보다, 그 CI가 실행하는 코드와 사용할 수 있는 권한이 핵심이다.
공개 PR은 누구나 변경할 수 있는 비신뢰 입력으로 취급한다.

| 위치 | 포함할 내용 | 실행 권한 |
|---|---|---|
| public `h66rogi/rogichat` | apps/packages 전체, lockfile, Dockerfile, Terraform 모듈·환경 root, 값 없는 설정 예제, Compose/Caddy 템플릿, CI·배포 프로토콜 문서 | hosted PR 검증은 read-only; 검토된 qa 소스의 별도 publisher만 GHCR 쓰기 |
| private `h66rogi/rogichat-ops` | 환경별 source SHA/root 선택, 서비스별 image digest, 실제 비밀 아닌 운영 입력·참조, 배포 요청 이력, SSH 공개키 목록, 운영 정책 원본 | 요청·검증 역할; 저장소 push 자체에는 cloud/SSH 적용 권한 없음 |
| GitHub 밖 관리 영역 | state/plan/full log, cloud·broker 자격증명, SSH 개인키·known_hosts, Tailscale 등록 정보, 인증서 키, 모바일 signing 자산 | 서버가 관리하는 인가·승인 후 plan/apply/deploy |

IaC 구현의 원본은 공개 모노레포에 둔다. ops에서 Terraform 소스를 복제·수정하지 않고
immutable commit SHA로 참조한다. 공개 템플릿으로 제3자도 자기 환경에 구축할 수 있게 한다.
private는 비밀 보관함이 아니다. 공개키만 지정 access 경로에 허용하고, 개인키·토큰 등
금지 자산은 private Git/Secrets/Actions log·artifact에도 넣지 않는다. 운영 정책 원본의 변경도 관리 실행기에 자동 반영하지 않는다.

## GitHub Free 조직의 제약

2026-09-19 공식 문서 기준이며, 구현 시 실제 설정 화면/API로 다시 확인한다.

| 기능 | Free에서의 차이 | 설계 반영 |
|---|---|---|
| standard hosted Actions | public 무료, private는 조직 공유 월 2,000분·artifact 500 MB; cache는 저장소별 10 GB | 공개 검증·unsigned 빌드 유지, private는 작은 명세 검사 중심; macOS 및 초과 사용 예산 별도 확인 |
| protected branches / rulesets | Free public 지원, Free private 미지원 | private의 CODEOWNERS/PR merge를 적용 승인 경계로 간주하지 않음 |
| environments / deployment approval | Free private environments 미지원 | `environment: qa`나 required reviewer로 비밀 접근을 막는 설계를 하지 않음 |
| organization secrets / variables | Free private repo에서 사용 불가 | org secret 공유를 전제로 하지 않음; 필요한 인증은 외부 관리 영역에 둠 |
| secret scanning / push protection | public에 적용한 기능이 Free private에 동일 제공된다고 가정할 수 없음 | private에도 로컬 scanner/hook·CI 적용, 비밀 자체는 외부 보관 |

근거: [Actions 한도](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository),
[environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[organization secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[secret scanning](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning).
Team 업그레이드는 private branch protection과 environments 일부를 제공하지만,
private required deployment reviewers까지 자동 제공하는 것은 아니다. 플랜 변경만으로
실행 코드·자격증명 격리 문제가 해결되지 않는다.

조직 base permission도 확인해야 한다. 현재 `h66rogi`는 `read`이므로 새 private repo는
외부인에게 비공개여도 조직 멤버 전체에게 읽기 권한이 상속될 수 있다.
운영자만 열람하도록 하려면 기존 저장소의 접근 영향을 검토한 뒤 조직 base를 `none`으로
바꾸고 팀별 접근을 명시하거나, 별도 접근 경계의 조직/계정을 선택해야 한다.
저장소 한 곳의 권한을 낮추는 것으로 조직 base 권한을 제거할 수 없다.
이번 작업에서 조직 권한은 변경하지 않았다.
[조직 기본 권한](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/setting-base-permissions-for-an-organization).

## CI와 배포 요청의 신뢰 경계

1. public PR은 GitHub-hosted 임시 runner에서 lint/test/build·secret 검사만 수행한다.
   cloud/SSH/signing 자산, tailnet 연결, private ops checkout 권한은 제공하지 않는다.
   fork approval은 실행 비용 제어일 뿐 코드를 신뢰하게 만드는 보안 경계가 아니다.
2. 검토된 qa SHA로 web/api 이미지를 독립 빌드한다. registry 쓰기는 별도 publish 단계에
   한정하고 의존성 설치·테스트에 배포 자격증명을 주지 않는다. digest와 provenance를 기록한다.
   PR artifact/cache를 privileged job에서 코드로 실행하지 않는다.
3. ops에는 source SHA·image digest·대상 환경·서비스를 명세로 제안한다.
   공개 CI에 ops 쓰기 토큰을 주지 않고 운영자 또는 관리 영역의 제한된 bot이 갱신한다.
   public `workflow_run`/`repository_dispatch` 성공만으로 privileged 실행을 시작하지 않는다.
4. 외부 실행기는 서버에 고정한 허용 저장소·workflow·환경 정책으로 provenance와
   GitHub 실행의 event/ref/SHA·성공 상태를 검증한다. attestations는 출처 증거이며
   코드의 안전성에 대한 보증이 아니므로 실행할 소스의 검토도 필요하다.
5. 배포 승인은 source SHA, ops SHA, 전체 release manifest digest, 환경, 유효시간에
   결합한다. 적용 직전 승인자 권한과 대상이 그대로인지 확인한다. mutable branch/tag,
   바뀐 명세, 만료·재사용된 승인은 거부한다. private merge는 승인 대체 수단이 아니다.
6. 서버에 미리 검토·배치한 helper만 Tailscale 위 SSH로 서비스 digest를 바꾼다.
   ops/source에 담긴 임의 shell·Compose·workflow를 root 권한으로 실행하지 않는다.
   앱별 배포는 독립적으로 요청하되 host 공통 lock으로 직렬화한다.

public 저장소의 branch protection은 활용하되 현재 설치된 ruleset은 삭제·force-push
방지에 한정된다. 필수 리뷰·CI가 이미 강제된 상태라고 간주하지 않는다.
release workflow 활성화 전에 보호 범위와 승인자 목록을 검토·설정해야 한다.

## Atlantis 배치

Atlantis는 private ops만 정확한 repo allowlist로 수신하도록 하는 B안을 권고한다.
공개 저장소의 PR/comment와 연결하지 않고 fork·자동 plan을 비활성화한다.
웹훅은 서명 검증·재전송 방지 후에도 즉시 plan 권한을 부여하지 않는다.

Free private에서 `mergeable`, CODEOWNERS, 기본 브랜치 이름만 검사해서는 부족하다.
관리 영역의 인가기가 현재 승인자와 **ops SHA + public source SHA + root + 환경**을
확인한 후 plan worker를 연다. plan 자체도 provider 등의 코드를 실행하므로 source
검토·provider/module 고정·최소 권한·일회성 격리가 필요하다. 자동 apply는 하지 않는다.
apply 승인은 저장된 plan digest와 state lineage/serial·소스 버전에 결합하고,
state/source가 바뀌면 새 plan과 승인을 요구한다.

server-side workflow/policy는 PR이나 ops push로 덮어쓰지 못하게 관리한다.
full plan/log는 SSH 공개키 등이 포함될 수 있어 private GitHub에도 올리지 않고
외부 관리 저장소에 보관한다. GitHub에는 검증된 최소 상태만 반환한다.
Atlantis UI/로그는 관리망에서만 열고, 필요하면 서명 검증 webhook endpoint만 별도로 노출한다.
기존 [Atlantis 공격 검증 기준](../infrastructure/atlantis/README.md)의 실행·환경 경계를
그대로 적용하며 private라는 이유로 완화하지 않는다.

초기에는 별도 상시 Atlantis 운영비를 들이기 전에 관리 장치에서 동일한 고정 SHA/
saved plan 승인 절차로 QA를 bootstrap할 수 있다. Atlantis를 켜는 시점은 인가기·실행기
검증 후 결정한다. 앱 호스트에 광범위 cloud 권한을 가진 Atlantis를 함께 넣지 않는다.

## 결정과 남은 검증

권고안은 **public 소스·검증 CI + private ops + 외부 privileged 실행**이다.
CI 전체를 private로 옮기는 C안은 공개 피드백·무료 빌드 이점을 줄이며, 코드 실행 위험은
여전히 남으므로 초기 기본안으로 선택하지 않는다.

추가 검토할 범위는 조직 read 상속의 허용 범위와 관리 실행 위치다.
다음으로 악성/변경된 명세·승인 후 push·토큰 만료·동시
배포·키 유출을 검증한다. private repo와 공개키 목록은 생성했다. 조직 권한 변경과 신규 credential/webhook 연결은 없다.

SSH public-key 원본은 private ops `access/qa/keys`와 manifest에서 관리하고,
검증된 전체 목록을 서버 authorized_keys로 렌더링한다. public 소스 checkout에 키를 복사하지
않고 Terraform에 private ops 파일의 외부 경로를 전달한다. 개인키의 저장 정책은 변경하지 않았다.
실행 위치별 운영 방식은 [남은 인프라 결정](infrastructure-readiness.md)에 정리했다.
