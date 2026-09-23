import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { PhotoshopEditor } from "@/meloming/domains/schedule-template/components/photoshop-editor";
import { parseTemplateIdParam } from "@/meloming/domains/schedule-template/utils/parse-template-id";

type Props = {
  params: Promise<{ user: string; id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { user } = await params;
  return {
    title: `시간표 템플릿 편집 - ${user} 관리`,
  };
}

/**
 * 시간표 템플릿 편집 페이지 (F4 에디터 진입점).
 *
 * 접근 제어:
 * - 잘못된 id 형식 (`1abc`, `0`, `-1`, 빈 문자열) → notFound()
 * - feature flag `channelScheduleTemplate` off → 에디터 컴포넌트에서
 *   notFound() 처리 (posthog-js 는 client-only 라 서버에서 판정 불가)
 */
export default async function ChannelManageScheduleTemplateEditPage({
  params,
}: Props) {
  const { user, id } = await params;
  const templateId = parseTemplateIdParam(id);

  if (templateId === null) {
    notFound();
  }

  return (
    <PageErrorBoundary>
      <PhotoshopEditor user={user} templateId={templateId} />
    </PageErrorBoundary>
  );
}
