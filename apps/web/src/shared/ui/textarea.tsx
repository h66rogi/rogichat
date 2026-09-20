import * as React from 'react';

import { cn } from '@/shared/lib/cn';

// Adapted from the official shadcn/ui "textarea" template (MIT). Border uses the control-border token
// (3.69:1 on white) rather than the decorative line colour; focus uses the focus-ring token.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-14 w-full rounded-sm border border-control-border bg-canvas px-4 py-3 text-[16px] leading-normal text-ink placeholder:text-muted outline-none focus-visible:border-focus-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-soft disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
