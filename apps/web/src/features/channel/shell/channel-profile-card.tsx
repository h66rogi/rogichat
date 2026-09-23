import type { ChannelDescriptor } from '../model/channel-descriptor';
import { ChannelAvatar } from './channel-avatar';

/**
 * Adapted from meloming-front f8907f37e73d0b760eac3c5af2beb48714331c83
 * `src/domains/channel/components/channel/user-header.tsx` (`variant="sidebar"`): centred round avatar,
 * name and a short action row. Rogichat changes: share sheet, favourites, badges, manage link and
 * upload are removed; only approved public links render; no counts are shown.
 */
export function ChannelProfileCard({ channel, compact = false }: { channel: ChannelDescriptor; compact?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-3 pt-6 pb-2 text-center">
      <ChannelAvatar name={channel.displayName} src={channel.avatarSrc} className={compact ? 'size-16' : 'size-24'} />
      <div className="flex max-w-full flex-col items-center gap-1.5">
        <p className="max-w-full truncate text-[20px] font-bold text-ink">{channel.displayName}</p>
      </div>
      {channel.officialLinks.length > 0 ? (
        <ul className="flex flex-wrap justify-center gap-2">
          {channel.officialLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-full border border-control-border px-3 text-[14px] font-medium text-ink hover:bg-surface-soft"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
