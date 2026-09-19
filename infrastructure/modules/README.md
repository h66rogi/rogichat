# Terraform modules

후속 구현 후보: `aws-lightsail-host`, `cloudflare-dns`, `github-oidc-role`.
공유 backend bucket과 기존 OIDC provider를 이중 관리하지 않는다.
provider별 차이를 가리는 거대한 multi-cloud module 대신 작은 명시적 입력/출력을 사용한다.
