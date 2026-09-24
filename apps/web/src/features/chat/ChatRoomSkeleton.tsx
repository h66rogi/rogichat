/** Matches the chat layout so initial hydration has no text or layout jump. */
export function ChatRoomSkeleton() {
  return <section className="flex h-full min-h-[60vh] flex-1 flex-col bg-canvas" aria-label="채팅을 불러오는 중" aria-busy="true" data-testid="chat-skeleton">
    <div className="hidden border-b border-line-subtle px-5 py-4 md:block"><div className="h-5 w-36 rounded bg-surface-strong motion-safe:animate-pulse" /></div>
    <div className="flex flex-1 flex-col justify-end gap-5 px-4 py-6">
      {[false, true, false, true, false].map((own, index) => <div key={index} className={`flex items-end gap-2 ${own ? 'justify-end' : ''}`}>
        {!own && <div className="size-8 shrink-0 rounded-full bg-surface-strong motion-safe:animate-pulse" />}
        <div className={`h-10 rounded-2xl bg-surface-strong motion-safe:animate-pulse ${index === 2 ? 'w-48' : index === 3 ? 'w-28' : 'w-36'}`} />
      </div>)}
    </div>
    <div className="border-t border-line-subtle p-4"><div className="h-11 rounded-full bg-surface-strong motion-safe:animate-pulse" /></div>
    <span className="sr-only" role="status">채팅을 불러오는 중입니다.</span>
  </section>;
}
