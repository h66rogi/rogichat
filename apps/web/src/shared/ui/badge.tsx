import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/shared/lib/cn';

// Adapted from the official shadcn/ui "badge" template (MIT). Badges always carry text; colour is not
// the only signal (DESIGN.md accessibility section).
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-5 [&>svg]:pointer-events-none [&>svg]:size-3.5',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-ink text-canvas',
        secondary: 'border-transparent bg-surface-strong text-ink',
        outline: 'border-control-border bg-canvas text-ink',
        brand: 'border-transparent bg-brand/10 text-action-hover',
        destructive: 'border-transparent bg-danger/10 text-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
