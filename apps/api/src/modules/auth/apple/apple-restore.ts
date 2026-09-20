export type AppleRestorePhase = 'identities' | 'transactions' | 'credentials';
export interface AppleRestoreInput { phase: AppleRestorePhase; afterId: string | null; limit: number }
export interface AppleRestorePage {
  phase: AppleRestorePhase; lastId: string | null; hasMore: boolean; processed: number;
  pendingRevocations: number; providerConfigured: boolean;
}
export interface AppleRestoreReadiness {
  quarantined: boolean; identitiesPending: boolean; transactionsPending: boolean; credentialsPending: boolean;
  upstreamRevocationPending: boolean; providerConfigured: boolean;
}
