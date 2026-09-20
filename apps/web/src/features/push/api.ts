import {
  PUSH_CAPABILITIES_PATH,
  PUSH_PREFERENCES_PATH,
  PUSH_SUBSCRIPTIONS_PATH,
  isGeneration,
  parseCapabilities,
  parsePreferences,
  parseSubscriptionIdentity,
  subscriptionBody,
  subscriptionPath,
} from './contract';
import type { NotificationPreferences, PushCapabilities, PushSubscriptionIdentity, PushSubscriptionInput } from './contract';
import { PushError, classify } from './errors';
import type { PushHttp, PushHttpRequest } from './transport';

/**
 * The five M11 enrollment calls, with the exact statuses and response shapes of the backend
 * contract. Every response is validated before it is returned: an unexpected status or shape
 * is a failure, never a value the UI can present as a working subscription.
 */
export class PushApi {
  private readonly http: PushHttp;

  constructor(http: PushHttp) {
    this.http = http;
  }

  /** `{available:false}` or `{available:true,applicationServerKey}`; 503 means unconfigured provider. */
  async capabilities(signal?: AbortSignal): Promise<PushCapabilities> {
    const json = await this.call({ path: PUSH_CAPABILITIES_PATH, method: 'GET' }, 200, signal);
    return parseCapabilities(json) ?? this.reject();
  }

  /** Absent server state projects `pushEnabled:false, generation:"1"`; the server does that, not us. */
  async preferences(signal?: AbortSignal): Promise<NotificationPreferences> {
    const json = await this.call({ path: PUSH_PREFERENCES_PATH, method: 'GET' }, 200, signal);
    return parsePreferences(json) ?? this.reject();
  }

  /**
   * Compare-and-set against the generation from the most recent read. A 409 means the stored
   * value moved; the caller must re-read and ask the user again rather than replay this value.
   */
  async setPreferences(pushEnabled: boolean, expectedGeneration: string, signal?: AbortSignal): Promise<NotificationPreferences> {
    if (!isGeneration(expectedGeneration)) throw new PushError('invalid-request');
    const json = await this.call({ path: PUSH_PREFERENCES_PATH, method: 'PUT', body: { pushEnabled, expectedGeneration } }, 200, signal);
    return parsePreferences(json) ?? this.reject();
  }

  /**
   * New endpoints omit `generation`; a rotation or same-account session rebinding sends the
   * current one. The 201 response carries only `{id,generation}` and never echoes endpoint or keys.
   */
  async register(input: PushSubscriptionInput, signal?: AbortSignal): Promise<PushSubscriptionIdentity> {
    const json = await this.call({ path: PUSH_SUBSCRIPTIONS_PATH, method: 'POST', body: subscriptionBody(input) }, 201, signal);
    return parseSubscriptionIdentity(json) ?? this.reject();
  }

  /** Revocation is generation CAS on the owning session; the 204 response has no body. */
  async remove(id: string, generation: string, signal?: AbortSignal): Promise<void> {
    if (!isGeneration(generation)) throw new PushError('invalid-request');
    const json = await this.call({ path: subscriptionPath(id), method: 'DELETE', body: { generation } }, 204, signal);
    if (json !== null) this.reject();
  }

  private async call(request: Omit<PushHttpRequest, 'signal'>, expected: number, signal?: AbortSignal): Promise<unknown> {
    let response;
    try {
      response = await this.http(signal ? { ...request, signal } : request);
    } catch (error) {
      // The transport reports a state it already knows, such as a session without a usable
      // CSRF token; an abort belongs to the caller's scope, not to the product error states.
      if (error instanceof PushError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new PushError('network');
    }
    if (response.status !== expected) throw classify(response.status, response.json);
    return response.json;
  }

  private reject(): never {
    throw new PushError('invalid-response');
  }
}
