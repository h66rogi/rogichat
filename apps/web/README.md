# Web

후로기 전용 웹. `/`이 후로기 채널 홈이며 채팅은 `/chat`에서 제공한다.
현재는 계획 단계로 앱 scaffold와 실제 기능은 아직 없다.

- [프론트엔드 웹 구현 계획](../../docs/frontend-web-implementation-plan.md): 화면, 멜로밍 선별 이식, 서버 계약, 단계별 완료 조건
- [DESIGN.md](DESIGN.md): Airbnb 스타일을 적용한 로기챗 웹 디자인 기준
- [다층 독립 리뷰 기록](../../docs/frontend-web-implementation-review.md): 지적·반영·재검토 결과와 남은 구현 gate

Next.js App Router 기반. 최신 stable scaffold는 설계 리뷰 다음 단계다.
QA 웹은 `qa.rogi.chat`, API는 `api.qa.rogi.chat/v1`, Socket.IO transport는
API host의 `/socket.io`를 제안한다. API host-only cookie와 정확한 CORS/CSRF 계약을 따른다.
사용자에게 보이는 이름은 로기챗이다.
Docker standalone output에서 monorepo tracing root와 static/public assets를 검증한다.
후속 CI/CD는 web 전용 GHCR image/digest를 배포한다.
