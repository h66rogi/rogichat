import { cn } from "@/shared/lib/cn";
import { cva, type VariantProps } from "class-variance-authority";

const skeletonVariants = cva("animate-pulse rounded-md", {
  variants: {
    variant: {
      default: "bg-accent",
      muted: "bg-muted",
      card: "bg-card border",
    },
    size: {
      default: "",
      sm: "h-4",
      md: "h-6",
      lg: "h-8",
      xl: "h-10",
      "2xl": "h-12",
      avatar: "w-10 h-10 rounded-full",
      "avatar-lg": "w-30 h-30 rounded-full",
      button: "h-10 w-20",
      "button-md": "h-8 w-16",
      badge: "h-6 w-16",
      "badge-md": "h-8 w-20",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

interface SkeletonProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof skeletonVariants> {}

function Skeleton({ className, variant, size, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      className={cn(skeletonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Skeleton };
