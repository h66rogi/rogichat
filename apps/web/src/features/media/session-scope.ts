import { ApiError, type ApiClient } from '../../core/api/client';
import { MediaClient } from './client';
import type { MediaLifetime } from './contracts';
import { MediaBudget } from './byte-budget';

/** One mounted, verified account/room scope. No browser persistence or signed URL state. */
export class MediaSessionScope {
  private readonly abort = new AbortController();
  readonly lifetime: MediaLifetime;
  readonly client: MediaClient;
  readonly configured: boolean;
  readonly budget = new MediaBudget();
  private readonly parent: MediaLifetime | undefined;
  constructor(api: ApiClient, csrf: string, origins: readonly string[], invalidate: () => void, parent?: MediaLifetime) {
    this.parent = parent;
    this.lifetime = { signal: this.abort.signal, isCurrent: () => !this.abort.signal.aborted && (!parent || (!parent.signal.aborted && parent.isCurrent())) };
    this.configured = origins.length > 0;
    const denied = () => { this.dispose(); invalidate(); };
    this.client = new MediaClient({ apiOrigin: api.origin, storageOrigins: origins, csrf: () => csrf, lifetime: this.lifetime,
      budget: this.budget,
      onUnauthorized: denied,
      verifySession: async signal => {
        try {
          const current = await api.session(signal);
          if (current.csrfToken !== csrf || current.soopLinkStatus !== 'VERIFIED') throw new ApiError(401, 'SESSION_CHANGED');
        } catch (error) {
          // A disposed image/room request is cancellation, not a global account change.
          if (!signal.aborted && !this.abort.signal.aborted) denied();
          throw error;
        }
      },
    });
    parent?.signal.addEventListener('abort', this.dispose, { once: true });
    if (parent?.signal.aborted) this.dispose();
  }
  dispose = () => { this.abort.abort(); this.parent?.signal.removeEventListener('abort', this.dispose); };
}
