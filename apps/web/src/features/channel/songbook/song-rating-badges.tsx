import { cn } from "@/shared/lib/cn";
import StarList from "./star-list";

export type SongPrimaryRatingField = "difficulty" | "proficiency";

type SongRatingBadgesProps = {
  difficulty?: number | null;
  proficiency?: number | null;
  size?: number;
  className?: string;
  itemClassName?: string;
  showDifficultyLabel?: boolean;
  showProficiencyLabel?: boolean;
  mode?: "all" | "primary";
  primaryField?: SongPrimaryRatingField;
};

function isRating(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function SongRatingBadges({
  difficulty,
  proficiency,
  size = 12,
  className,
  itemClassName,
  showDifficultyLabel = true,
  showProficiencyLabel = true,
  mode = "all",
  primaryField = "difficulty",
}: SongRatingBadgesProps) {
  if (mode === "primary") {
    const value = primaryField === "proficiency" ? proficiency : difficulty;
    const label = primaryField === "proficiency" ? "숙련도" : "난이도";
    const tone = primaryField === "proficiency" ? "green" : "yellow";
    if (!isRating(value)) return null;

    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <div className={cn("flex items-center gap-1", itemClassName)}>
          {showDifficultyLabel && (
            <span className="text-[10px] text-muted-foreground">{label}</span>
          )}
          <StarList star={value} size={size} tone={tone} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {isRating(difficulty) && (
        <div className={cn("flex items-center gap-1", itemClassName)}>
          {showDifficultyLabel && (
            <span className="text-[10px] text-muted-foreground">난이도</span>
          )}
          <StarList star={difficulty} size={size} />
        </div>
      )}
      {isRating(proficiency) && (
        <div className={cn("flex items-center gap-1", itemClassName)}>
          {showProficiencyLabel && (
            <span className="text-[10px] text-muted-foreground">숙련도</span>
          )}
          <StarList star={proficiency} size={size} tone="green" />
        </div>
      )}
    </div>
  );
}
