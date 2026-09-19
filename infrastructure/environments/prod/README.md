# Production root reservation

운영 도메인은 `rogi.chat`. QA와 다른 state, IAM role, DB, secrets를 사용한다.
QA 설계 검토가 production apply 권한이나 QA 자원의 production 재사용을 뜻하지 않는다.
현재 provision할 리소스가 없으며 main 브랜치 승격과 함께 별도 설계한다.
