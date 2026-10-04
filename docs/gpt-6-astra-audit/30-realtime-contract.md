# Realtime handshake contract

This contract closes F28. The protocol lives in `@xenode/realtime`
(`src/protocol.mjs` with `protocol.d.mts` types): Next.js issuers, the Drive
Socket.IO server (plain Node ESM, imported as `@xenode/realtime/protocol`) and
browser clients share one implementation. Drive's former duplicate verifier and
event helpers were removed.

## Tickets

`POST /api/realtime/token` (Drive and Photos) issues a 60-second, one-use
HMAC-SHA-256 ticket signed with `REALTIME_TICKET_SECRET`. Claims bind account,
product, Space, ProductSession ID, the ProductSession expiry
(`sessionExpiresAt`) and an `origin`:

- Cookie-authenticated (browser) requests must send an exact `Origin`; the ticket
  binds it. A request without one is refused (403).
- Only Drive bearer-authenticated native clients receive `origin: null`.

## Handshake

The server offers the WebSocket transport only; Socket.IO's CORS settings cover
HTTP long-polling, which browsers do not use here, and browsers do not enforce
CORS on WebSockets. Engine.IO's `allowRequest` therefore rejects any `Origin`
outside the exact `REALTIME_ALLOWED_ORIGIN` list before a ticket is read. The
Socket.IO middleware then verifies, in order: signature, claim shape, ticket
and session expiry, exact origin equality (an origin-less handshake needs an
origin-less ticket and vice versa), Redis revocation markers, and atomic
one-time consumption. The ticket store has no offline queue and a two-second
command timeout, so an unavailable Redis rejects handshakes instead of holding
them open. Clients send no cookies (`withCredentials: false`).

## Lifetime and revocation

A socket is disconnected at `min(sessionExpiresAt, connectedAt + 15 minutes)`,
so every connection re-authorizes with a fresh ticket at least every fifteen
minutes and never outlives its ProductSession. `SESSION_REVOKED` and
`ACCESS_REVOKED` events write their Redis marker before fan-out and disconnect
matching sockets; losing the subscriber connection disconnects every socket.

Clients use `realtimeTicketAuth(fetchTicket)` as Socket.IO's `auth` callback, so
each connection attempt, including reconnects, fetches a new ticket. After a
server-initiated disconnect (which Socket.IO does not retry automatically) the
guards probe their session; a revoked session reloads, otherwise the socket
reconnects.

## Evidence

`packages/realtime/tests/realtime.test.ts` covers origin binding, native
tickets, expiry, tampering, malformed input, issuance validation, revocation,
store failure, deadlines, allowlist parsing and the auth callback.
`apps/drive/tests/realtime/realtime-socket.test.ts` runs a real HTTP/Socket.IO
server with a Node client: hostile Origin (a negative control without the
allowlist gate fails), replay, cross-origin ticket reuse, native clients,
polling refusal, store failure, revocation markers, session-expiry disconnect,
revocation fan-out and a fresh ticket per reconnect. The production proxy,
real browsers and a deployed Redis remain release gates.
