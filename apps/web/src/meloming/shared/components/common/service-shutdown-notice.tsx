import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

import {
  SERVICE_NOTICE_URL,
  SERVICE_SHUTDOWN_DATE_LABEL,
} from "@/meloming/shared/constants/service-shutdown";

/**
 * 서비스 종료 안내를 모든 페이지 최상단에 고정으로 노출한다.
 *
 * 셸(NewShell / ChannelShell / ManageShell)보다 앞에 오고 스크롤해도 남는다.
 * 채널·관리 셸의 thin header 는 `sticky top-0` 이므로 이 바가 자기 높이를
 * `--meloming-top-notice-height` 로 알려주고 그만큼 아래에서 고정된다.
 *
 * 겉모습은 커미션의 같은 바(meloming-commission-front 8a7ed93f)를 따른다.
 * 같은 종료 안내가 두 서비스에서 다르게 보이면 안 된다. 색은 라이트/다크
 * 공통이다. 안내가 테마에 따라 옅어지면 안 되고, 진한 앰버 위 짙은 잉크
 * 조합이 두 테마 모두에서 같은 강도로 읽힌다.
 *
 * 좁아질수록 설명문 -> 공지 링크 라벨 순으로 감춘다. 제목이 종료일을 싣고
 * 있어 마지막까지 남아야 하는데, 360px 미만에서 라벨까지 두면 잘린다.
 *
 * 닫기 버튼은 두지 않는다. 종료 안내는 이용자가 반드시 봐야 하는 정보이고
 * 한 번 닫으면 다시 찾아갈 경로가 없다.
 */
export function ServiceShutdownNotice() {
  return (
    <div
      data-testid="service-shutdown-notice"
      className="sticky top-0 z-[70] h-[var(--meloming-top-notice-height)] border-b-2 border-amber-600 bg-amber-400"
    >
      <div className="container mx-auto flex h-full items-center gap-2 px-3 text-sm sm:px-6 lg:px-8">
        <AlertTriangle aria-hidden className="size-5 shrink-0 text-amber-950" />
        <p className="min-w-0 flex-1 truncate font-medium text-amber-950">
          <span className="font-bold">
            {SERVICE_SHUTDOWN_DATE_LABEL} 멜로밍 서비스 종료
          </span>
          <span className="hidden sm:inline">
            {" · "}자세한 일정과 데이터 처리 방안은 공지사항에서 확인해 주세요.
          </span>
        </p>
        <Link
          href={SERVICE_NOTICE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-950 px-3 py-1 font-semibold text-amber-50 transition-colors hover:bg-amber-900"
        >
          <span className="hidden min-[360px]:inline">공지사항 보기</span>
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
