import type { Metadata } from 'next';

import { PreviewFrame } from '@/preview/preview-frame';
import { previewActors, previewRooms } from '@/preview/fixtures/catalog';

export const metadata: Metadata = {
  title: 'QA 미리보기',
  robots: { index: false, follow: false },
};

/**
 * QA-only entry (file extension `.preview.tsx`, registered only in `ROGICHAT_WEB_ENV=qa` builds).
 * Explains what the preview screens are and are not.
 */
export default function PreviewIndexPage() {
  return (
    <PreviewFrame current="/preview">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-bold text-ink">화면 미리보기</h1>
          <p className="text-[16px] text-body">
            디자인 검증을 위한 합성 화면입니다. 로그인, SOOP 연결, 입장, 전송, 저장은 실제로 일어나지 않아요.
            여기서 입력한 내용은 새로고침하면 사라져요.
          </p>
        </div>
        <section className="flex flex-col gap-2 rounded-md border border-line px-5 py-4 text-[14px] text-body">
          <h2 className="text-[16px] font-semibold text-ink">샘플 구성</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>
              스트리머 2명: {previewActors.streamerHurogi.displayName}, {previewActors.streamerOther.displayName}
            </li>
            <li>
              팬 2명: {previewActors.fanA.displayName}, {previewActors.fanB.displayName}
            </li>
            <li>
              방 2개: {previewRooms.hurogi.title}, {previewRooms.other.title}. 다른 방의 내용이 섞이지 않는지 확인하는 용도예요.
            </li>
          </ul>
        </section>
        <section className="flex flex-col gap-2 rounded-md border border-line px-5 py-4 text-[14px] text-body">
          <h2 className="text-[16px] font-semibold text-ink">전송 결과 시연</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>보통 메시지: 보내는 중으로 표시된 뒤 결과 확인 중으로 바뀌어요. 저장 완료로 표시되지 않아요.</li>
            <li>
              본문에 <code>[거부]</code>가 있으면 약 2초 뒤 거부돼요. 그 사이 대상을 바꿔 두면 늦게 온 거부가 어떻게 표시되는지 볼 수 있어요.
            </li>
            <li>
              본문에 <code>[지연]</code>이 있으면 약 2초 뒤에 접수돼요.
            </li>
          </ul>
        </section>
      </div>
    </PreviewFrame>
  );
}
