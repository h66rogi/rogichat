# Rogichat

후로기(h66rogi)를 위한 SOOP 중심 채팅·커뮤니티 서비스.
공개 모노레포이며, 현재 단계는 **보안 기반 설정과 아키텍처 검토**다.
앱 실행 코드, 클라우드 리소스, 배포 파이프라인은 설계 검토 후 순서대로 구현한다.

## 구조

```text
infrastructure/             # Terraform, Atlantis 관리 경계, 호스트 배포
  environments/{qa,prod}/   # 환경별 독립 root/state
  modules/                 # AWS/Cloudflare 제공자별 재사용 모듈
  atlantis/                # 별도 관리 영역의 실행 정책
  runtime/                 # Docker Compose와 호스트 운영 계약
apps/{web,api,android,ios}/ # Next.js, NestJS, Kotlin, Swift
packages/                  # 계약, 생성 SDK, 디자인 토큰, 웹 UI, 공통 설정
tools/security/            # 공개 저장소 유출 방지
docs/                      # 설계, 조사 근거, 리뷰
```

환경: `qa` 브랜치 → `qa.rogi.chat`; `main` 승격 → `rogi.chat`의 prod.
AWS 리전은 서울(`ap-northeast-2`). QA는 Lightsail 한 대에서 PostgreSQL과
Docker 기반 web/api를 운영할 계획이다. GHCR은 컨테이너 레지스트리이며,
JavaScript 의존성 관리는 pnpm workspace를 사용한다.

## 먼저 읽기

1. [공개 저장소 보안](SECURITY.md)
2. [설계안](docs/architecture.md)
3. [기존 서비스 재사용 조사](docs/reference-audit.md)
4. [인프라·배포 설계](docs/infrastructure-and-delivery.md)
5. [버전 검증](docs/toolchain.md)
6. [다각도 리뷰와 다음 단계](docs/design-review.md)

## 개발자 보안 설정

Python 3.11 이상, Git, HTTPS 접근이 필요하다. macOS/Linux arm64/x64를 지원한다.

```sh
python3 tools/security/install.py
git config core.hooksPath .githooks
python3 -m unittest discover -s tools/security -p 'test_*.py'
python3 tools/security/check.py all
```

스캐너가 없거나 실패하면 커밋과 푸시를 차단한다. 환경 파일은 이름에
`.example`이 붙은 가짜 값 템플릿만 허용한다. 템플릿도 비밀정보 검사를 받는다.
새 앱을 생성할 때 프레임워크 버전을 다시 확인하고 정확한 버전과 lockfile을 기록한다.
