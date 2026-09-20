/** One-way equality binding; raw credentials never enter persistent browser storage. */
export async function sessionBinding(csrfToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csrfToken));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
