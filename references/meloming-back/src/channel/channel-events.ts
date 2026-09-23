/**
 * Lifecycle events emitted by ChannelService.
 *
 * Decouples downstream cache/index invalidation (e.g. SongCacheService) from
 * ChannelModule so consumers can react without ChannelModule importing the
 * Song layer (which would create a circular dependency: SongModule already
 * imports ChannelModule).
 *
 * Emitted AFTER the parent DB write commits. Listeners must isolate failures
 * — errors must NEVER propagate back to the emitter.
 */

export const CHANNEL_EVENTS = {
  CHANNEL_DELETED: 'channel.deleted',
} as const;

export interface ChannelDeletedEvent {
  channelId: number;
  /** Lower-cased web path snapshot, captured before delete. Null if absent. */
  webPath: string | null;
}
