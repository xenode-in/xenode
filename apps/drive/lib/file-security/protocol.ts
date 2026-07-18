import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const runtimeEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    sessionId: z.string().uuid(),
    nonce: z.string().min(32).max(128),
    requestId: z.number().int().nonnegative(),
    type: z.enum([
      "INIT",
      "OPEN",
      "SAVE",
      "CLOSE",
      "READY",
      "RESULT",
      "ERROR",
    ]),
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(200 * 1024 * 1024)
      .optional(),
    payload: z.unknown(),
  })
  .strict();

export type RuntimeMessage = z.infer<typeof runtimeEnvelopeSchema>;

export const LEGAL_RUNTIME_TRANSITIONS = {
  CREATED: ["BOOTSTRAPPED"],
  BOOTSTRAPPED: ["INITIALIZED", "CLOSED"],
  INITIALIZED: ["READY", "CLOSED"],
  READY: ["OPENING", "CLOSED"],
  OPENING: ["OPEN", "CLOSED"],
  OPEN: ["SAVING", "CLOSING", "CLOSED"],
  SAVING: ["OPEN", "CLOSED"],
  CLOSING: ["CLOSED"],
  CLOSED: [],
} as const;

export type RuntimeState = keyof typeof LEGAL_RUNTIME_TRANSITIONS;

export function isLegalTransition(
  from: RuntimeState,
  to: RuntimeState,
): boolean {
  return (
    LEGAL_RUNTIME_TRANSITIONS[from] as readonly RuntimeState[]
  ).includes(to);
}
