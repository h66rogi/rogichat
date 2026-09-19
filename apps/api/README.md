# API

NestJS REST/Socket.IO + MySQL 호환 DB 기반. 최신 stable scaffold는 설계 리뷰 다음 단계다.
DB migration과 readiness를 앱 릴리스 순서에 포함한다.
`user`, `platform_soop`, `auth` 경계를 두고 기존 OAuth broker와 일회용 code로 연동한다.
QA host는 `api.qa.rogi.chat`. [인증 설계](../../docs/soop-authentication.md)를 따른다.
Talk 전체 모듈을 복사하지 않고 계약·인가·영속화 의존을 선별 추출한다.
후속 CI/CD는 api 전용 GHCR image/digest를 배포한다.

후속 [제품·권한 설계](../../docs/backend-design.md), [독립 리뷰](../../docs/backend-review.md),
[다중 인스턴스 구현 계획](../../docs/backend-implementation-plan.md)을 따른다.
초기 실시간 권고는 본문 없는 Socket.IO hint + 현재 권한을 적용한 REST sync다.
