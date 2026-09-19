# Toolchain 검증 기록

2026-09-19 조회한 **후보 기준**이다. 현재 앱 의존성을 설치한 상태가 아니다.
scaffold 시 다시 확인해 정확한 버전, lockfile, 컨테이너 digest와 CI runner를 고정한다.
최신 stable과 prerelease를 구분하며, 설치 가능함과 전체 호환 검증을 구분한다.

| 항목 | 확인한 stable/후보 | 출처·주의 |
|---|---|---|
| Node.js | 24.21.0 LTS 계열 | [release index](https://nodejs.org/dist/index.json); 기존 로컬 24.11.1은 Nest generator 최소 버전 미달 |
| Next.js | 16.3.5 | [npm metadata](https://registry.npmjs.org/next/latest) |
| React | 19.3.0 | [npm metadata](https://registry.npmjs.org/react/latest); Next peer range와 함께 검증 |
| Nest core/CLI/schematics | 12.0.3 | [core](https://registry.npmjs.org/@nestjs/core/latest), [schematics](https://registry.npmjs.org/@nestjs/schematics/latest) |
| pnpm / Turbo | 12.4.2 / 2.11.2 | [pnpm](https://registry.npmjs.org/pnpm/latest), [Turbo](https://registry.npmjs.org/turbo/latest); workspace 호환 확인 후 고정 |
| Terraform | 1.16.3 | [release](https://github.com/hashicorp/terraform/releases/tag/v1.16.3) |
| AWS provider | 6.65.0 | [release](https://github.com/hashicorp/terraform-provider-aws/releases/tag/v6.65.0) |
| Cloudflare provider | 5.25.0 | [release](https://github.com/cloudflare/terraform-provider-cloudflare/releases/tag/v5.25.0) |
| Atlantis | 0.47.1 | [release](https://github.com/runatlantis/atlantis/releases/tag/v0.47.1); Terraform CLI/provider를 별도 고정 |
| PostgreSQL | 18.6 후보 | [공식 발표](https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/); ORM·백업 도구와 검증 |
| Android AGP | Google Maven stable 9.4.1 | [metadata](https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml) |
| Kotlin | 2.4.20 후보 | [공식 릴리스](https://kotlinlang.org/docs/releases.html); AGP 내장 Kotlin·KSP·Hilt 조합 검증 |
| Gradle/JDK | AGP 9.4 기준 Gradle 9.6.0, JDK 17 | [호환표](https://developer.android.com/build/releases/agp-9-4-0-release-notes); 내장 Kotlin 2.2.10 기본값과 명시적 최신 Kotlin 정책 조정 필요 |
| iOS | Xcode 27 / Swift 6.4 후보 | [Apple 호환표](https://developer.apple.com/xcode/system-requirements); 실제 macOS hosted runner 이미지 제공 여부 확인 필요 |

Context7에서 Next.js, NestJS, Atlantis 라이브러리를 resolve하고 각각 문서를 조회했다.

- Next standalone은 모노레포 root까지 `outputFileTracingRoot`를 설정한다.
  image에 `.next/static`과 public assets 및 standalone 하위 앱 경로가 포함되는지 검증한다.
  [Next output 문서](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
- Nest 12의 ESM 전환과 generator 런타임은 별개다. schematics는 Node 22.22.3+,
  24.15+ 또는 26+를 요구하므로 이번 기준은 최신 Node 24로 통일한다.
  [Nest migration 문서](https://docs.nestjs.com/migration-guide).
- Atlantis는 plan도 코드 실행 경계다. fork PR 차단과 서버 관리 workflow를 사용한다.
  [Atlantis 보안 문서](https://www.runatlantis.io/docs/security).

모바일 deployment target/minSdk는 빌드 도구의 최신 버전과 별개 결정이다.
기존 iOS 16 기준을 유지할지, Android 최소 API를 어디에 둘지는 사용자층과 SDK
요구사항으로 검토한다. 현재는 구체 target/bundle ID/스토어 계정을 발급하지 않았다.
