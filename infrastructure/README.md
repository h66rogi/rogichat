# Infrastructure

Terraform 코드는 이 저장소에서 소유한다. 환경은 qa/prod, AWS 기본 리전은
`ap-northeast-2`. 실제 적용 상태와 고정 source SHA는 private ops에서 관리한다.

- `environments/qa`: 구현된 AWS·Cloudflare root와 격리 복원 시험.
- `environments/prod`: 별도 EC2·Aurora root와 기본 비활성 DNS.
  [운영 사전 준비와 활성화 조건](environments/prod/README.md)을 따른다.
  코드 게시와 실제 운영 자원 생성·서비스 공개는 별개다.
- `modules`: provider별 모듈. Terraform CLI/provider 및 module source 버전을 고정한다.
- `atlantis`: 자격증명 보유 실행기의 신뢰 경계.
- `runtime`: Docker Compose와 host 배포 계약.

실제 backend.hcl, tfvars, plan, state는 저장소 밖에 보관한다.
`.terraform.lock.hcl`은 구현 시 커밋하고 provider checksum을 검증한다.
환경 root를 분리하고 workspace 이름 변경만으로 prod를 선택하지 않는다.
