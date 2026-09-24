export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold">멜로밍 오버레이</h1>
        <p className="text-sm text-neutral-300">
          이 서비스는 OBS 브라우저 소스용 위젯을 제공합니다. 채널 관리 대시보드에서
          오버레이 URL을 복사해 사용하세요.
        </p>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
          <p className="text-neutral-300">예시 경로</p>
          <p className="mt-2 font-mono text-xs text-neutral-100">
            /overlay/&#123;token&#125;/widgets/queue
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-100">
            /overlay/&#123;token&#125;/widgets/now-playing
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-100">
            /overlay/&#123;token&#125;/widgets/total
          </p>
        </div>
      </div>
    </main>
  );
}
