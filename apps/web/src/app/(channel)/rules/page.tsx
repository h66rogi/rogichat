import type { Metadata } from 'next';

import { resolveDefaultChannel } from '@/features/channel/model/channel-descriptor';

export const metadata: Metadata = {
  title: '이용 안내',
};

/**
 * Public usage guide. This is not the terms of service or the privacy policy; those documents are
 * linked here once their final text and public paths are confirmed.
 */
export default function RulesPage() {
  const channel = resolveDefaultChannel();
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:px-8 md:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold text-ink">이용 안내</h1>
        <p className="text-[16px] text-body">{channel.displayName} 채팅방을 이용할 때 알아 두면 좋은 내용입니다.</p>
      </header>

      <Section title="채팅은 이렇게 동작해요">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>{channel.displayName}와 채팅방에서 대화를 나눌 수 있어요.</li>
          <li>메시지가 서버에 저장된 것과 상대가 읽은 것은 달라요. 읽음 여부는 표시하지 않아요.</li>
        </ul>
      </Section>

      <Section title="삭제, 방 나가기, 계정 탈퇴">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>메시지 삭제 기능의 제공 여부는 채팅 화면에서 확인해 주세요. 삭제가 서버에서 완료되면 연결된 공개본에도 반영돼요.</li>
          <li>방을 나가도 계정은 유지되고, 이미 보낸 메시지는 지워지지 않아요. 다시 들어오면 새로 참여하는 것으로 시작해요.</li>
          <li>계정 탈퇴는 방 나가기와 달라요. 현재 웹에서는 계정 탈퇴 기능을 제공하지 않아요.</li>
        </ul>
      </Section>

      <Section title="신고와 문의">
        <p>부적절한 메시지의 신고 방법과 문의 경로는 담당 절차가 확정되는 대로 이 페이지에 안내해요.</p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[22px] font-semibold text-ink">{title}</h2>
      <div className="text-[16px] leading-normal text-body">{children}</div>
    </section>
  );
}
