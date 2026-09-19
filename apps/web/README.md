# Web

Next.js App Router 기반. 최신 stable scaffold는 설계 리뷰 다음 단계다.
API는 same-origin `/api/v1`, Socket.IO transport는 `/socket.io`를 제안한다.
Docker standalone output에서 monorepo tracing root와 static/public assets를 검증한다.
후속 CI/CD는 web 전용 GHCR image/digest를 배포한다.
