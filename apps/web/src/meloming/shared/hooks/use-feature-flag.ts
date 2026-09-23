'use client'

import { FeatureFlags, type FeatureFlagName } from '@/meloming/shared/lib/feature-flags'

export function useFeatureFlag(flag: FeatureFlagName): boolean {
  return FeatureFlags[flag].default
}
