export type RealtimeProduct = "drive" | "photos" | "mobile" | "office-editor";

export declare const REALTIME_CHANNEL: "xenode:sync:events";
export declare const REALTIME_TICKET_MAX_TTL_SECONDS: 60;
export declare const REALTIME_CONNECTION_MAX_SECONDS: number;
export declare const REALTIME_PRODUCTS: readonly RealtimeProduct[];

export interface RealtimeTicketClaims {
  ticketId: string;
  accountId: string;
  productId: RealtimeProduct;
  spaceId: string;
  sessionId: string;
  /** Exact page origin that requested the ticket; null for native clients. */
  origin: string | null;
  issuedAt: number;
  expiresAt: number;
  /** ProductSession expiry (Unix seconds); bounds the socket lifetime. */
  sessionExpiresAt: number;
}

export interface ProductSessionRevokedEvent {
  id: string;
  type: "SESSION_REVOKED";
  userId: string;
  productId: string;
  sessionId: string;
  expiresAt: string;
  occurredAt: string;
}

export interface RealtimeTicketStore {
  /** Atomically mark the ticket used; false when it was already consumed. */
  consume(ticketId: string, ttlSeconds: number): Promise<boolean>;
  isRevoked?(claims: RealtimeTicketClaims): Promise<boolean>;
}

export type RealtimeTicketErrorCode =
  | "malformed"
  | "signature"
  | "claims"
  | "expired"
  | "origin"
  | "revoked"
  | "replayed";

export declare class RealtimeTicketError extends Error {
  readonly code: RealtimeTicketErrorCode;
  constructor(code: RealtimeTicketErrorCode);
}

export interface ParsedRealtimeEvent {
  kind: "session-revoked" | "access-revoked" | "sync";
  event: Record<string, unknown> & {
    id: string;
    type: string;
    userId: string;
    productId: RealtimeProduct;
    sessionId?: string;
    spaceId?: string;
  };
  room: string;
  markerKey: string | null;
  markerTtl: number | null;
}

export interface RealtimeSocketData {
  accountId?: string;
  productId?: string;
  spaceId?: string;
  sessionId?: string;
}

export declare function isRealtimeProduct(value: unknown): value is RealtimeProduct;
export declare function exactRealtimeOrigin(value: unknown): string | null;
export declare function parseRealtimeAllowedOrigins(value: string | undefined): string[];
export declare function validRealtimeTicketClaims(value: unknown): value is RealtimeTicketClaims;
export declare function issueRealtimeTicket(
  claims: RealtimeTicketClaims,
  secret: string,
): Promise<string>;
export declare function verifyRealtimeTicket(
  ticket: unknown,
  options: RealtimeTicketStore & {
    secret: string;
    origin: string | null | undefined;
    nowSeconds?: number;
  },
): Promise<RealtimeTicketClaims>;
export declare function realtimeConnectionDeadline(
  claims: Pick<RealtimeTicketClaims, "sessionExpiresAt">,
  connectedAt: number,
): number;
export declare function realtimeTicketAuth(
  fetchTicket: () => Promise<string | null | undefined>,
): (callback: (auth: { token?: string }) => void) => void;
export declare function realtimeRoom(productId: string, spaceId: string): string;
export declare function realtimeAccountRoom(
  productId: string,
  accountId: string,
): string;
export declare function realtimeRevokedSessionKey(sessionId: string): string;
export declare function realtimeRevokedAccessKey(
  accountId: string,
  productId: string,
  spaceId: string,
): string;
export declare function createProductSessionRevokedEvent(args: {
  eventId: string;
  accountId: string;
  productId: string;
  sessionId: string;
  sessionExpiresAt: Date;
  occurredAt?: Date;
}): ProductSessionRevokedEvent;
export declare function parseRealtimeEvent(
  rawEvent: unknown,
  nowMs?: number,
): ParsedRealtimeEvent | null;
export declare function shouldDisconnectRealtimeSocket(
  parsed: ParsedRealtimeEvent,
  socketData: RealtimeSocketData,
): boolean;
