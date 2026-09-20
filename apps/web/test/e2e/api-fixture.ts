/** Synthetic server data ONLY for isolated browser tests, never imported by src. */
import { expect, type Page, type Route } from '@playwright/test';
export const TEST_SCOPES = { membershipScope: 'A'.repeat(43), authorizationRevision: 'B'.repeat(42) + 'A' };
export const TEST_PARTITION = 'C'.repeat(42) + 'A';
export const TEST_ROOM_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_ACTOR_ID = '22222222-2222-4222-8222-222222222222';
export const TEST_PROFILE = { id: '33333333-3333-4333-8333-333333333333', nickname: '테스트 팬', avatar: null, birthday: null, birthdayVisibleToStreamers: false };
export async function json(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin ?? 'http://127.0.0.1:3101';
  await route.fulfill({ status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' }, ...(status === 204 ? {} : { body: JSON.stringify(body) }) });
}
export async function installApi(page: Page, authenticated = false) {
  const state = { authenticated, sessionStatus: 200, sessionToken: 'synthetic-csrf-session-A', profile: { ...TEST_PROFILE }, profileStatus: 200, logoutStatus: 204, joined: false, rooms: true, logoutCount: 0 };
  await page.route('https://api.qa.rogi.chat/v1/**', async route => {
    if (route.request().method() === 'OPTIONS') { await json(route, null, 204); return; }
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/auth/session') { await json(route, state.authenticated ? { authenticated: true, accountPartition: TEST_PARTITION, csrfToken: state.sessionToken, soopLinkStatus: 'VERIFIED' } : {}, state.authenticated ? state.sessionStatus : 401); return; }
    if (!state.authenticated && path !== '/v1/auth/soop/start') { await json(route, {}, 401); return; }
    if (path === '/v1/me/profile') {
      if (route.request().method() === 'PATCH') {
        expect(route.request().headers()['x-csrf-token']).toBe(state.sessionToken);
        if (state.profileStatus === 200) Object.assign(state.profile, route.request().postDataJSON());
      }
      await json(route, state.profile, state.profileStatus); return;
    }
    if (path === '/v1/auth/logout') { state.logoutCount++; expect(route.request().headers()['x-csrf-token']).toBe(state.sessionToken); if (state.logoutStatus === 204) state.authenticated = false; await json(route, {}, state.logoutStatus); return; }
    if (path === '/v1/rooms') { await json(route, { rooms: state.rooms ? [{ roomId: TEST_ROOM_ID, name: '후로기', mode: 'FAN', joined: state.joined, ...(state.joined ? { actorId: TEST_ACTOR_ID, ...TEST_SCOPES } : {}) }] : [], next: null }); return; }
    if (path === `/v1/rooms/${TEST_ROOM_ID}/join`) { expect(route.request().headers()['x-csrf-token']).toBe(state.sessionToken); state.joined = true; await json(route, { actorId: TEST_ACTOR_ID, historyPolicy: 'SINCE_JOIN', policyVersion: 1, ...TEST_SCOPES }); return; }
    if (path === `/v1/rooms/${TEST_ROOM_ID}/leave`) { expect(route.request().headers()['x-csrf-token']).toBe(state.sessionToken); state.joined = false; await json(route, null, 204); return; }
    if (path === '/v1/auth/soop/start') { await json(route, {}, 503); return; }
    await json(route, {}, 404);
  });
  return state;
}
