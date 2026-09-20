import * as React from 'react';

import { cn } from '@/shared/lib/cn';

// Adapted from the official shadcn/ui "input" template (MIT) with the 56px DESIGN.md input height.
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-14 w-full min-w-0 rounded-sm border border-control-border bg-canvas px-4 py-2 text-[16px] text-ink placeholder:text-muted outline-none file:border-0 file:bg-transparent file:text-[14px] file:font-medium focus-visible:border-focus-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-soft disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
