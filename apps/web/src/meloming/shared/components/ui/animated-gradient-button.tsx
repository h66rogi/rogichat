import * as React from "react";
import { cn } from "@/meloming/shared/lib/utils";
import { Button } from "@/meloming/shared/components/ui/button";

interface AnimatedGradientButtonProps
  extends React.ComponentProps<typeof Button> {
  wrapperClassName?: string;
  gradientClassName?: string;
  children: React.ReactNode;
}

export function AnimatedGradientButton({
  className,
  wrapperClassName,
  gradientClassName,
  children,
  ...props
}: AnimatedGradientButtonProps) {
  return (
    <div className={cn("relative group inline-flex", wrapperClassName)}>
      <div
        className={cn(
          "absolute -inset-[1.5px] rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-70 blur-[2px] transition duration-1000 group-hover:opacity-100 group-hover:duration-200 animate-spin-slow",
          gradientClassName
        )}
      />
      <Button
        className={cn(
          "relative w-full bg-background hover:bg-background/90 text-foreground border-0",
          className
        )}
        {...props}
      >
        {children}
      </Button>
    </div>
  );
}

