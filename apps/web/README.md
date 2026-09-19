# Web

Next.js App Router 기반. 최신 stable scaffold는 설계 리뷰 다음 단계다.
QA 웹은 `qa.rogi.chat`, API는 `api.qa.rogi.chat/v1`, Socket.IO transport는
API host의 `/socket.io`를 제안한다. API host-only cookie와 정확한 CORS/CSRF 계약을 따른다.
사용자에게 보이는 이름은 로기챗이다.
Docker standalone output에서 monorepo tracing root와 static/public assets를 검증한다.
후속 CI/CD는 web 전용 GHCR image/digest를 배포한다.
