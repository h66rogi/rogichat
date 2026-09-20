// Upgraded sockets share Node's HTTP server connection budget with ordinary
// requests. Finite headroom prevents the realtime ceiling alone exhausting it;
// arbitrary additional HTTP traffic can still exhaust the shared budget.
export const REALTIME_CONNECTION_LIMIT = 1000;
export const HTTP_CONNECTION_RESERVE = 64;
export const HTTP_CONNECTION_LIMIT = REALTIME_CONNECTION_LIMIT + HTTP_CONNECTION_RESERVE;
