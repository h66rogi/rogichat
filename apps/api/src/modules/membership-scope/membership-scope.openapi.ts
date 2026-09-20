export const scopeToken = { type: 'string' as const, minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' };
export const scopeFields = { membershipScope: scopeToken, authorizationRevision: scopeToken };
