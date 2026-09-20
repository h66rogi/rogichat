import type { Metadata } from 'next';

import { PreviewFrame } from '@/preview/preview-frame';
import { PreviewSettingsHarness } from '@/preview/preview-settings-harness';

export const metadata: Metadata = {
  title: '내 설정 미리보기',
  robots: { index: false, follow: false },
};

/** QA-only settings preview. Sections render from synthetic state; no request is sent anywhere. */
export default function SettingsPreviewPage() {
  return (
    <PreviewFrame current="/preview/settings">
      <div data-preview-slot="settings" className="flex min-w-0 flex-1 flex-col">
        <PreviewSettingsHarness />
      </div>
    </PreviewFrame>
  );
}
