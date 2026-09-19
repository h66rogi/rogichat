# 공개 저장소 보안

이 저장소의 코드, Git 이력, PR, Actions 로그·artifact, 공개 이미지는 누구나 읽을 수 있다.
민감한 보안 제보는 공개 Issue에 값이나 증거 원문을 올리지 말고 GitHub의
비공개 취약점 제보 기능을 이용한다.

## 현재 적용하는 방어

- GitHub Secret scanning 및 Push protection 활성화.
- `.gitignore`와 `.dockerignore`로 환경 파일·인증서·state·plan·모바일 서명 파일 제외.
- `pre-commit`: Git index의 실제 blob 전부를 검사. 부분 스테이징과 강제 add도 검사.
- `pre-push`와 CI: 현재 index 및 모든 reachable Git 이력의 Gitleaks 검사.
- 체크섬으로 고정한 Gitleaks 8.30.1. 누락·실행 실패 시 차단.
- 인라인 `gitleaks:allow` 무시, `.gitleaksignore` 금지, 전체 baseline 예외 없음.
- SSH 공개키도 게시 금지: `.pub`/authorized_keys/known_hosts 경로 차단 및
  임의 파일·과거 커밋 내 OpenSSH 공개키 본문을 별도 Gitleaks 규칙으로 검사.
- PR은 GitHub-hosted 일회성 runner, 읽기 전용 token, 자격증명 없는 checkout.
- Actions SHA 고정, 보안 경로 CODEOWNERS 지정, Dependabot Actions 업데이트.

로컬 hook은 clone마다 설치해야 하며 우회할 수 있다. CI는 이미 업로드된
커밋을 검사하므로 유출을 되돌리지 못한다. 서버 Push protection도 모든
비밀 형식을 탐지하지 않는다. 공개 전 검토, 로컬 검사, 서버 검사 모두 필요하다.
실제 비밀 대신 무작위처럼 보이는 테스트 토큰을 문서에 넣지 않는다.

## 저장 위치 계약

| 항목 | 위치 | 공개 Git/이미지 포함 |
|---|---|---|
| DB 비밀번호·세션 서명키 | QA 전용 secret 저장소 → 호스트 root 소유 파일 | 금지 |
| Cloudflare token | 관리 영역의 secret 저장소, 해당 zone에 최소 권한 | 금지 |
| AWS 인증 | 작업자 프로필 또는 짧은 수명 역할 세션 | 금지 |
| Actions AWS 인증 | GitHub OIDC + repo/environment 한정 trust | 정적 키 금지 |
| Terraform state·plan | 접근 제한 원격 backend/관리 영역 | 금지 |
| Apple/Android 서명 키 | 보호된 배포 환경 secret, 임시 keychain/파일 | 금지 |
| SSH 개인키·공개키 | GitHub 밖의 관리 실행기·서버 authorized_keys | GitHub Secrets/log/artifact에도 금지 |
| NEXT_PUBLIC 값·앱 번들 설정 | 누구나 볼 수 있는 주소/공개 식별자만 | 공개로 취급 |
| API 계약·테스트 | 합성 데이터, 비식별 fixture | 가능 |

Compose secrets는 자동 암호화 저장소가 아니다. 호스트 파일 권한·백업 암호화가
따로 필요하다. `sensitive = true`도 Terraform state 안의 값을 암호화하지 않는다.
cloud-init/user_data, Docker ARG/ENV, Terraform output에 실제 secret을 넣지 않는다.
민감한 plan·state·DB 덤프를 Actions artifact나 PR 댓글에 올리지 않는다.

## 코드 재사용과 운영

기존 서비스에서는 지정한 소스만 선별 이식한다. Git 이력 전체, `.env`,
Firebase 설정, 서명 자산, 운영 데이터, 사설 도메인·계정 식별자를 가져오지 않는다.
원본과 외부 자산의 라이선스·재배포 권리는 파일별 이식 기록에 남긴다.
현재 저장소 공개만으로 기존 코드 전체에 새 라이선스를 부여하지 않는다.

로그에는 메시지 본문·쿠키·Authorization·토큰·DB 연결문자열을 기록하지 않는다.
유출이 확인되면 추가 게시를 중단하고 위치와 영향을 비공개로 확인한다.
값을 재출력하지 않으며, Git에서 지우기만 하면 해결됐다고 판단하지 않는다.

로기챗 로그인은 [전용 중계 계약](docs/soop-authentication.md)으로 SOOP 계정을 검증한 뒤
자체 세션을 발급한다. 외부 서비스 세션 쿠키·JWT·SOOP 토큰을 로기챗 세션으로 받지 않는다.

Atlantis는 별도 보안 경계다. [실행 정책](infrastructure/atlantis/README.md)을
충족하기 전 public repository webhook을 연결하지 않는다.
