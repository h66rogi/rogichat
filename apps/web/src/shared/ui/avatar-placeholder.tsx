import { UserRound } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/** A stable visual placeholder while private or remote avatar bytes load. */
export function AvatarPlaceholder({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('flex size-full items-center justify-center rounded-full bg-surface-strong text-muted', className)}>
    <UserRound className="size-1/2" strokeWidth={1.5} />
  </span>;
}
