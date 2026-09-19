# Infrastructure

Terraform 코드는 이 저장소에서 소유한다. 환경은 qa/prod, AWS 기본 리전은
`ap-northeast-2`. 초기 단계에는 실행 가능한 resource root를 두지 않는다.

- `environments/qa`: AWS·Cloudflare별 독립 root/state를 구현할 위치.
- `environments/prod`: QA 검증 이후 별도 root/state로 준비할 위치.
- `modules`: provider별 모듈. Terraform CLI/provider 및 module source 버전을 고정한다.
- `atlantis`: 자격증명 보유 실행기의 신뢰 경계.
- `runtime`: Docker Compose와 host 배포 계약.

실제 backend.hcl, tfvars, plan, state는 저장소 밖에 보관한다.
`.terraform.lock.hcl`은 구현 시 커밋하고 provider checksum을 검증한다.
환경 root를 분리하고 workspace 이름 변경만으로 prod를 선택하지 않는다.
