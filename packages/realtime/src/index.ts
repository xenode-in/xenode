// The protocol is plain JavaScript (protocol.mjs + protocol.d.mts) so the
// Drive Socket.IO server can import it under Node without a build step.
export {
  REALTIME_CHANNEL,
  REALTIME_CONNECTION_MAX_SECONDS,
  REALTIME_PRODUCTS,
  REALTIME_TICKET_MAX_TTL_SECONDS,
  RealtimeTicketError,
  createProductSessionRevokedEvent,
  exactRealtimeOrigin,
  isRealtimeProduct,
  issueRealtimeTicket,
  parseRealtimeAllowedOrigins,
  parseRealtimeEvent,
  realtimeAccountRoom,
  realtimeConnectionDeadline,
  realtimeRevokedAccessKey,
  realtimeRevokedSessionKey,
  realtimeRoom,
  realtimeTicketAuth,
  shouldDisconnectRealtimeSocket,
  validRealtimeTicketClaims,
  verifyRealtimeTicket,
} from "./protocol.mjs";
export type {
  ParsedRealtimeEvent,
  ProductSessionRevokedEvent,
  RealtimeProduct,
  RealtimeSocketData,
  RealtimeTicketClaims,
  RealtimeTicketErrorCode,
  RealtimeTicketStore,
} from "./protocol.mjs";
