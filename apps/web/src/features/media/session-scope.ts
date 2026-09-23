import { sessionAllowsChat } from '../../core/api/session-contract';
import { ApiError, type ApiClient } from '../../core/api/client';
import { MediaImageResource } from './image-resource';
import { MediaClient } from './client';
import type { MediaLifetime } from './contracts';
import { MediaBudget } from './byte-budget';
import { VideoClient, type VideoClientOptions } from './video-client';

/** One mounted, verified account/room scope. No browser persistence or signed URL state. */
export class MediaSessionScope {
  private readonly abort = new AbortController();
  readonly lifetime: MediaLifetime;
  readonly client: MediaClient;
  readonly configured: boolean;
  readonly budget = new MediaBudget();
  private readonly videoOptions: VideoClientOptions;
  videoClient(lifetime: MediaLifetime) { return new VideoClient({ ...this.videoOptions, lifetime }); }
  private readonly providerAvatars = new Map<string, { resource: MediaImageResource; users: number }>();
  acquireProviderAvatar(roomId: string, actorId: string) {
    const key = JSON.stringify([roomId, actorId]);
    let entry = this.providerAvatars.get(key);
    if (!entry) {
      const resource = new MediaImageResource({ lifetime: this.lifetime, image: (_id, _context, signal) => this.client.providerAvatar(roomId, actorId, signal) });
      entry = { resource, users: 0 }; this.providerAvatars.set(key, entry);
      void resource.load(actorId, { variant: 'image', roomId, actorId });
    }
    entry.users++;
    let released = false;
    return { resource: entry.resource, release: () => {
      if (released) return; released = true;
      if (--entry.users === 0) { entry.resource.dispose(); this.providerAvatars.delete(key); }
    } };
  }
  private readonly parent: MediaLifetime | undefined;
  constructor(api: ApiClient, csrf: string, origins: readonly string[], invalidate: () => void, parent?: MediaLifetime) {
    this.parent = parent;
    this.lifetime = { signal: this.abort.signal, isCurrent: () => !this.abort.signal.aborted && (!parent || (!parent.signal.aborted && parent.isCurrent())) };
    this.configured = origins.length > 0;
    const denied = () => { this.dispose(); invalidate(); };
    const options: VideoClientOptions = { apiOrigin: api.origin, storageOrigins: origins, csrf: () => csrf, lifetime: this.lifetime,
      budget: this.budget,
      onUnauthorized: denied,
      verifySession: async signal => {
        try {
          const current = await api.session(signal);
          if (current.csrfToken !== csrf || !sessionAllowsChat(current)) throw new ApiError(401, 'SESSION_CHANGED');
        } catch (error) {
          // A disposed image/room request is cancellation, not a global account change.
          if (!signal.aborted && !this.abort.signal.aborted) denied();
          throw error;
        }
      },
    };
    this.client = new MediaClient(options); this.videoOptions = options;
    parent?.signal.addEventListener('abort', this.dispose, { once: true });
    if (parent?.signal.aborted) this.dispose();
  }
  dispose = () => { this.abort.abort(); for (const entry of this.providerAvatars.values()) entry.resource.dispose(); this.providerAvatars.clear(); this.parent?.signal.removeEventListener('abort', this.dispose); };
}
