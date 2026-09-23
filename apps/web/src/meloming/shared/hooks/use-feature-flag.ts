'use client'

import { useSyncExternalStore } from 'react'
import { useFeatureFlagVariantKey } from 'posthog-js/react'
import { FeatureFlags, type FeatureFlagName } from '@/meloming/shared/lib/feature-flags'

const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function useFeatureFlag(flag: FeatureFlagName): boolean {
  const flagDef = FeatureFlags[flag]

  // posthog.getFeatureFlag(key) 원본 값을 사용한다 (useFeatureFlagEnabled = isFeatureEnabled = !!getFeatureFlag 이라
  // "미로딩/부재"와 "명시적 false"를 둘 다 false 로 뭉개므로 default ON 플래그가 PostHog 장애 때 OFF 로 죽는다).
  // - undefined : PostHog 가 값을 못 줌 (flags 미로딩 / 엔드포인트 장애 / 프로젝트에 flag 미정의) → 코드 default 사용
  // - true|false|variant : PostHog 가 명시적으로 평가한 값 → override (false 면 kill switch 로 OFF 유지)
  const raw = useFeatureFlagVariantKey(flagDef.key)

  // SSR 및 client 첫 렌더는 default 값으로 고정해 hydration mismatch (React #418) 방지.
  // PostHog는 client 전용이라 SSR에서는 undefined를 반환하므로, mount 후에만 실제 값 반영.
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
  if (!mounted) return flagDef.default

  return raw === undefined ? flagDef.default : Boolean(raw)
}
