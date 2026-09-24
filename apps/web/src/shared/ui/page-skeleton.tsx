/** Quiet, shape-matched loading state for private screens. */
export function PageSkeleton() {
  return <section className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 md:px-8" aria-busy="true" aria-label="화면을 불러오는 중">
    <div className="h-7 w-40 rounded bg-surface-strong motion-safe:animate-pulse" />
    <div className="space-y-4 rounded-xl border border-line-subtle p-5">
      <div className="flex items-center gap-4"><div className="size-16 shrink-0 rounded-full bg-surface-strong motion-safe:animate-pulse" /><div className="space-y-2"><div className="h-5 w-36 rounded bg-surface-strong motion-safe:animate-pulse" /><div className="h-4 w-24 rounded bg-surface-strong motion-safe:animate-pulse" /></div></div>
      <div className="h-4 w-3/4 rounded bg-surface-strong motion-safe:animate-pulse" />
    </div>
    <div className="h-28 rounded-xl border border-line-subtle bg-surface-soft motion-safe:animate-pulse" />
    <span className="sr-only" role="status">화면을 불러오는 중입니다.</span>
  </section>;
}
