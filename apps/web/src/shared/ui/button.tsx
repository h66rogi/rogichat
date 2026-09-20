import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/shared/lib/cn';

// Adapted from the official shadcn/ui "button" template (MIT) with 로기챗 DESIGN.md sizing:
// 48px default control height, 8px radius, control-border/focus-ring tokens, 44px minimum touch target.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm text-[16px] font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: 'bg-action text-on-action hover:bg-action-hover',
        outline: 'border border-control-border bg-canvas text-ink hover:bg-surface-soft',
        secondary: 'bg-surface-strong text-ink hover:bg-line-subtle',
        ghost: 'text-ink hover:bg-surface-soft',
        link: 'text-ink underline-offset-4 hover:underline',
        destructive: 'bg-danger text-on-action hover:bg-danger/90',
      },
      size: {
        default: 'h-12 px-5',
        sm: 'h-11 px-4 text-[14px]',
        lg: 'h-14 px-6',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}

export { Button, buttonVariants };
