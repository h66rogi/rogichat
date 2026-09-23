import { Coins, Sparkles } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import type { SongRequestPriceItem } from "@/meloming/domains/channel/utils/song-request-price-display";

interface SongRequestPricePillsProps {
  items: SongRequestPriceItem[];
  className?: string;
}

function BalloonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3c3.9 0 6.5 2.9 6.5 6.7 0 4.4-3.5 7-6.5 8.4-3-1.4-6.5-4-6.5-8.4C5.5 5.9 8.1 3 12 3z" />
      <path d="M12 18.2v2.7" />
      <path d="M10.7 22h2.6" />
    </svg>
  );
}

function CheeseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 10.5 12 6l8 4.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7.5z" />
      <circle cx="10" cy="13" r="1.2" />
      <circle cx="15.5" cy="15.5" r="1" />
      <circle cx="7.2" cy="16.3" r=".9" />
    </svg>
  );
}

const BeamIcon = Sparkles;

const CURRENCY_DEFS: ReadonlyArray<{
  keyMatch: string;
  unitMatch: string;
  Icon: React.FC<{ className?: string }>;
  badgeClass: string;
}> = [
  { keyMatch: "SOOP", unitMatch: "별풍선", Icon: BalloonIcon, badgeClass: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-500/30 dark:bg-pink-500/10 dark:text-pink-300" },
  { keyMatch: "CHZZK", unitMatch: "치즈", Icon: CheeseIcon, badgeClass: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" },
  { keyMatch: "CIME", unitMatch: "빔", Icon: BeamIcon, badgeClass: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300" },
];

const DEFAULT_TOKEN_CLASS = "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";

function resolveCurrencyDef(currencyKey: string | null, unit: string) {
  const key = currencyKey?.toUpperCase() ?? "";
  return CURRENCY_DEFS.find((d) => key.includes(d.keyMatch) || unit.includes(d.unitMatch));
}

function CurrencyIcon({
  currencyKey,
  unit,
  className,
}: {
  currencyKey: string | null;
  unit: string;
  className?: string;
}) {
  const Icon = resolveCurrencyDef(currencyKey, unit)?.Icon ?? Coins;
  return <Icon className={className} />;
}

function getTokenClassName(currencyKey: string | null, unit: string) {
  return resolveCurrencyDef(currencyKey, unit)?.badgeClass ?? DEFAULT_TOKEN_CLASS;
}

function formatAmount(item: SongRequestPriceItem): string {
  if (item.price == null) {
    return "무료";
  }
  return `${item.price.toLocaleString()}${item.unit ? ` ${item.unit}` : ""}`;
}

export function SongRequestPricePills({
  items,
  className,
}: SongRequestPricePillsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.map((item) => {
        const key = `${item.currencyKey ?? "default"}:${item.source}`;
        return (
          <span
            key={key}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none",
              getTokenClassName(item.currencyKey, item.unit)
            )}
          >
            <CurrencyIcon
              currencyKey={item.currencyKey}
              unit={item.unit}
              className="size-3.5"
            />
            <span>{formatAmount(item)}</span>
          </span>
        );
      })}
    </div>
  );
}

