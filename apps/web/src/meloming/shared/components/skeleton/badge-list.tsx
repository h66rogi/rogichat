import { Skeleton } from "@/meloming/shared/components/ui/skeleton";

function SkeletonBadgeList({
  count = 6,
  badgeVariant = "badge-md",
}: {
  count?: number;
  badgeVariant?: "badge" | "badge-md";
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} size={badgeVariant} />
      ))}
    </div>
  );
}

export { SkeletonBadgeList };
