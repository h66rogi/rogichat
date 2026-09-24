import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { AvatarPlaceholder } from '@/shared/ui/avatar-placeholder';
import { cn } from '@/shared/lib/cn';

/**
 * Adapted from meloming-front f8907f37e73d0b760eac3c5af2beb48714331c83
 * `src/domains/channel/components/channel/user-avatar.tsx`: Avatar with an initial-letter fallback.
 * Rogichat changes: no click easter egg, no hover scaling; the fallback is the neutral placeholder used
 * until approved artwork exists.
 */
export function ChannelAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-24', className)}>
      {src ? <AvatarImage src={src} alt={`${name} 프로필 사진`} /> : null}
      <AvatarFallback aria-label={src ? undefined : `${name} 기본 프로필`}><AvatarPlaceholder /></AvatarFallback>
    </Avatar>
  );
}
