import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/meloming/shared/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden select-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        indigo:
          "border-transparent bg-indigo-500 text-background [a&]:hover:bg-indigo-500/90",
        "indigo-outline":
          "border-indigo-500 bg-transparent text-indigo-500 [a&]:hover:bg-indigo-500/90",
        soop: "border-transparent bg-blue-500 text-background [a&]:hover:bg-blue-500/90",
        chzzk:
          "border-transparent bg-green-500 text-background [a&]:hover:bg-green-500/90",
        cime: "border-transparent bg-violet-500 text-background [a&]:hover:bg-violet-500/90",
        yellow:
          "border-transparent bg-yellow-400 text-yellow-950 [a&]:hover:bg-yellow-400/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ellipsisCount,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    ellipsisCount?: number;
  }) {
  const Comp = asChild ? Slot : "span";

  // ellipsisCount가 지정된 경우 텍스트 자르기 처리
  const processedChildren = React.useMemo(() => {
    if (ellipsisCount !== undefined) {
      // children을 문자열로 변환
      let textContent = "";
      if (typeof children === "string") {
        textContent = children;
      } else if (Array.isArray(children)) {
        textContent = children.join("");
      } else if (children !== null && children !== undefined) {
        textContent = String(children);
      }

      if (textContent.length > ellipsisCount) {
        return `${textContent.slice(0, ellipsisCount)}...`;
      }
    }
    return children;
  }, [children, ellipsisCount]);

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {processedChildren}
    </Comp>
  );
}

export { Badge, badgeVariants };
