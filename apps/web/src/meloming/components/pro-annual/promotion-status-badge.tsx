import type { PromotionStatus } from "@/meloming/domains/subscription-promotion/types/subscription-promotion";

const MAP: Record<PromotionStatus, { label: string; cls: string }> = {
  NOT_STARTED: { label: "오픈 예정", cls: "bg-neutral-200 text-neutral-700" },
  ACTIVE: { label: "진행 중", cls: "bg-rose-500 text-white" },
  SOLD_OUT: { label: "품절", cls: "bg-neutral-800 text-white" },
  ENDED: { label: "종료", cls: "bg-neutral-400 text-white" },
};

interface PromotionStatusBadgeProps {
  status: PromotionStatus;
}

export function PromotionStatusBadge({ status }: PromotionStatusBadgeProps) {
  const m = MAP[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
