import { Star } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

interface StarListProps {
  star: number;
  size?: number;
  tone?: "yellow" | "green";
}

const STAR_COLOR_BY_TONE = {
  yellow: "var(--color-yellow-500)",
  green: "var(--color-green-500)",
} as const;

export default function StarList({
  star,
  size = 12,
  tone = "yellow",
}: StarListProps) {
  const uuid = uuidv4();
  const color = STAR_COLOR_BY_TONE[tone];

  return (
    <div className="flex flex-row gap-0.5">
      {Array.from({ length: star }).map((_, index) => (
        <Star
          key={`${uuid}-${index}`}
          size={size}
          fill={color}
          color={color}
        />
      ))}
    </div>
  );
}
