# 로기챗

후로기(h66rogi)를 위한 SOOP 중심 채팅·커뮤니티 서비스.
비상업적 이용을 허용하는 소스 공개(source-available) 모노레포이며,
현재 단계는 **QA 인프라와 백엔드 M01–M04 기반 구현**이다.
QA EC2·Aurora·Caddy와 검증 CI가 준비됐으며, 백엔드 인증·프로필·방 권한을 격리 DB에서 검증했다.
실제 API 배포·SOOP 로그인·채팅 출시 gate는 별도로 추적하며 완료된 것으로 간주하지 않는다.
[구현 계획과 상태](docs/backend-mvp-execution-plan.md)를 참고한다.

## 라이선스

이 저장소의 자체 코드와 문서는 별도 표시가 없는 한
[PolyForm Noncommercial License 1.0.0](LICENSE)을 따른다.
SPDX 식별자는 `PolyForm-Noncommercial-1.0.0`이며,
저작권 및 필수 고지는 [NOTICE](NOTICE)에 있다.

- 라이선스가 허용하는 비상업적 목적의 사용·수정·재배포가 가능하다.
  비상업적 목적의 외부 서비스 운영도 일률적으로 금지하지 않는다.
- 개인 이용과 비상업적 기관 이용의 허용 범위는 라이선스 원문을 따른다.
  상업적 이용 등 허용 범위 밖의 이용에는 권리자의 별도 허락이 필요하다.
- 사본을 전달할 때 라이선스 원문 또는 해당 URL과 `Required Notice:` 고지를
  함께 전달해야 한다.
- 제3자 코드·자산에는 각각의 원래 라이선스와 고지가 적용된다.

상업적 이용을 제한하므로 OSI 정의의 오픈소스가 아닌 **소스 공개 소프트웨어**다.
이 안내는 요약이며, 구체적인 이용 조건은 라이선스 원문이 기준이다.

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
AWS 리전은 서울(`ap-northeast-2`). DB는 사용자 결정에 따라 MySQL 계열로 변경했다. 앱 EC2 + private Aurora MySQL 생성과 관리 접속·DB TLS를 검증했다.
API DNS를 EC2로 전환하고 Caddy HTTPS 검증 후 기존 Lightsail을 퇴역했다. [전환 검토](docs/ec2-aurora-review.md)를 따른다. GHCR은 컨테이너 레지스트리이며,
JavaScript 의존성 관리는 pnpm workspace를 사용한다.

## 먼저 읽기

1. [공개 저장소 보안](SECURITY.md)
2. [설계안](docs/architecture.md)
3. [기존 서비스 재사용 조사](docs/reference-audit.md)
4. [인프라·배포 설계](docs/infrastructure-and-delivery.md)
5. [버전 검증](docs/toolchain.md)
6. [다각도 리뷰와 다음 단계](docs/design-review.md)
7. [SOOP 소셜로그인 중계](docs/soop-authentication.md)
8. [Tailscale·SSH와 GitHub 밖의 배포](docs/host-access.md)
9. [브랜딩 기준](docs/branding.md)
10. [공개 소스와 private ops 분리](docs/repository-isolation.md)
11. [인프라 확정 사항과 남은 결정](docs/infrastructure-readiness.md)
12. [Service Worker·웹 푸시 기반 요구사항](docs/web-push-foundation.md)
13. [프론트엔드 웹 구현 계획](docs/frontend-web-implementation-plan.md)
14. [웹 디자인 기준](apps/web/DESIGN.md)

제품 표기는 **로기챗**으로 통일한다. QA 웹은 `qa.rogi.chat`, API는
`api.qa.rogi.chat`이다. 기존 OAuth callback을 유지하는 로그인 중계만 외부
인증 서버를 사용하며, 제품 화면·앱·이미지·메타데이터에 기존 브랜드를 재사용하지 않는다.

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
