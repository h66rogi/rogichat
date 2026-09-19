# API

NestJS REST/Socket.IO + PostgreSQL 기반. 최신 stable scaffold는 설계 리뷰 다음 단계다.
DB migration과 readiness를 앱 릴리스 순서에 포함한다.
Talk 전체 모듈을 복사하지 않고 계약·인가·영속화 의존을 선별 추출한다.
후속 CI/CD는 api 전용 GHCR image/digest를 배포한다.
