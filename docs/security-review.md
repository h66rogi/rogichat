# 보안 검토 기록

2026-09-19. 범위는 빈 공개 저장소의 foundation 변경이다. 실행 중인 앱이나
클라우드 인프라에 대한 침투 테스트 보고서가 아니다.

## 해결한 항목

- **SEC-001 / 높음**: 서버 secret scanning/push protection이 비활성 상태였다.
  두 설정을 활성화하고 GitHub API로 read-back했다. 비공개 취약점 제보도 활성화했다.
- **SEC-002 / 높음**: 공개 전 로컬 secret 검사 경로가 없었다.
  [index 검사](../tools/security/check.py#L53), history 검사와 hook을 추가했다.
  강제 add·부분 staging·삭제된 과거 secret·scanner 누락 테스트가 통과했다.
- **SEC-003 / 높음**: 향후 CI에서 PR code에 credential을 제공할 위험.
  [보안 workflow](../.github/workflows/security.yml#L9)는 contents read만 사용하며
  hosted runner, full SHA checkout, persist-credentials false를 적용한다.
  현재 배포 권한·cloud secret을 사용하는 job은 없다.

## 구현 전에 해결할 항목

- **SEC-004 / 높음**: Atlantis의 credentialed plan 실행 경계와 비공개 출력 저장소를
  아직 구현하지 않았다. 공격자가 실행 가능한 Terraform을 주입하면 plan 중에도
  클라우드 자격증명을 탈취할 수 있다. [Atlantis 설계](../infrastructure/atlantis/README.md)를
  검토·실증하기 전 webhook을 연결하지 않는다.
- **SEC-005 / 중간**: host 접근, secret 전달, backup restore는 설계 상태다.
  앱 배포 단계의 완료 조건으로 실제 권한과 복구 결과를 검증한다.

## 제한과 재검토

hook은 우회 가능하고 CI는 공개 이후 실행된다. Gitleaks와 GitHub 탐지 모두
임의 형식의 모든 비밀을 찾는 것은 아니다. 일반 패턴 탐지 추가 설정은 GitHub
read-back에서 활성화되지 않았으므로 활성화 완료로 보고하지 않는다.
CODEOWNERS 파일만으로 리뷰가 강제되지 않는다. 공개 PR에서 보안 검사 코드 자체를
수정할 수 있으므로 신뢰 경계 파일 변경은 사람의 검토가 필요하다.

현재 앱 code/DB/cloud mutation은 없다. 다음 단계에서 Next/Nest 설정·인증·
권한·로그·업로드를 실제 코드 기준으로 다시 검토한다.
