import {
  isLegalTransition,
  PROTOCOL_VERSION,
  runtimeEnvelopeSchema,
  type RuntimeMessage,
  type RuntimeState,
} from "./protocol";

type Pending = {
  resolve: (message: RuntimeMessage) => void;
  reject: (error: Error) => void;
  timeout: number;
  operation: "INIT" | "OPEN" | "SAVE" | "CLOSE";
};

export class IsolatedRuntimeSession {
  readonly sessionId = crypto.randomUUID();
  readonly nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  private state: RuntimeState = "CREATED";
  private requestId = 0;
  private port: MessagePort | null = null;
  private readonly pending = new Map<number, Pending>();
  private readonly runtimeOrigin: string;
  private readonly iframe: HTMLIFrameElement;

  constructor(iframe: HTMLIFrameElement, runtimeOrigin: string) {
    const parsed = new URL(runtimeOrigin);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("Runtime origin must use HTTPS");
    }
    if (parsed.origin === window.location.origin) {
      throw new Error("Runtime must not share the trusted app origin");
    }
    this.iframe = iframe;
    this.runtimeOrigin = parsed.origin;
  }

  bootstrap(): void {
    if (!isLegalTransition(this.state, "BOOTSTRAPPED")) {
      throw new Error("Runtime session has already been bootstrapped");
    }
    const target = this.iframe.contentWindow;
    if (!target) throw new Error("Runtime iframe is unavailable");

    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => this.onMessage(event);
    this.port.onmessageerror = () => this.fail(new Error("Runtime message could not be decoded"));
    this.port.start();

    target.postMessage(
      {
        type: "XENODE_RUNTIME_BOOTSTRAP",
        protocolVersion: PROTOCOL_VERSION,
        sessionId: this.sessionId,
        nonce: this.nonce,
      },
      this.runtimeOrigin,
      [channel.port2],
    );
    this.transition("BOOTSTRAPPED");
    this.transition("INITIALIZED");
  }

  async request(
    type: "INIT" | "OPEN" | "SAVE" | "CLOSE",
    payload: unknown,
    bytes?: ArrayBuffer,
    timeoutMs = 15_000,
  ): Promise<RuntimeMessage> {
    if (!this.port || this.state === "CLOSED") {
      throw new Error("Runtime session is closed");
    }
    const requiredState: Record<
      "INIT" | "OPEN" | "SAVE" | "CLOSE",
      RuntimeState | RuntimeState[]
    > = {
      INIT: "INITIALIZED",
      OPEN: "READY",
      SAVE: "OPEN",
      CLOSE: ["INITIALIZED", "READY", "OPEN"],
    };
    const allowed = requiredState[type];
    if (
      (Array.isArray(allowed) && !allowed.includes(this.state)) ||
      (!Array.isArray(allowed) && this.state !== allowed)
    ) {
      throw new Error(`Illegal ${type} request while runtime is ${this.state}`);
    }
    if (type === "OPEN") this.transition("OPENING");
    if (type === "SAVE") this.transition("SAVING");
    if (type === "CLOSE" && this.state === "OPEN") {
      this.transition("CLOSING");
    }
    const requestId = ++this.requestId;
    const byteLength = bytes?.byteLength;
    const message = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      nonce: this.nonce,
      requestId,
      type,
      byteLength,
      payload: bytes ? { value: payload, bytes } : payload,
    };
    const parsed = runtimeEnvelopeSchema.parse(message);

    return new Promise<RuntimeMessage>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Runtime request timed out"));
        this.close();
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout, operation: type });
      this.port!.postMessage(parsed, bytes ? [bytes] : []);
    });
  }

  markReady(): void {
    if (this.state === "INITIALIZED") this.transition("READY");
  }

  markOpening(): void {
    this.transition("OPENING");
  }

  markOpen(): void {
    this.transition("OPEN");
  }

  markSaving(): void {
    this.transition("SAVING");
  }

  close(): void {
    if (this.state === "CLOSED") return;
    if (this.state === "OPEN") this.transition("CLOSING");
    this.state = "CLOSED";
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("Runtime session closed"));
    }
    this.pending.clear();
    this.port?.close();
    this.port = null;
    this.iframe.remove();
  }

  private transition(next: RuntimeState): void {
    if (!isLegalTransition(this.state, next)) {
      throw new Error(`Illegal runtime transition: ${this.state} -> ${next}`);
    }
    this.state = next;
  }

  private onMessage(event: MessageEvent): void {
    const result = runtimeEnvelopeSchema.safeParse(event.data);
    if (!result.success) {
      this.fail(new Error("Runtime returned an invalid message"));
      return;
    }
    const message = result.data;
    if (message.sessionId !== this.sessionId || message.nonce !== this.nonce) {
      this.fail(new Error("Runtime session identity mismatch"));
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      this.fail(new Error("Runtime response was unsolicited or replayed"));
      return;
    }
    const payloadBytes =
      message.payload instanceof ArrayBuffer
        ? message.payload
        : message.payload &&
            typeof message.payload === "object" &&
            "bytes" in message.payload &&
            message.payload.bytes instanceof ArrayBuffer
          ? message.payload.bytes
          : undefined;
    if (
      (payloadBytes && message.byteLength !== payloadBytes.byteLength) ||
      (!payloadBytes && message.byteLength !== undefined)
    ) {
      this.fail(new Error("Runtime response buffer size mismatch"));
      return;
    }
    this.pending.delete(message.requestId);
    window.clearTimeout(pending.timeout);
    if (message.type === "ERROR") {
      pending.reject(new Error("Runtime reported an error"));
      this.close();
      return;
    }
    const expectedType = pending.operation === "INIT" ? "READY" : "RESULT";
    if (message.type !== expectedType) {
      const error = new Error(
        `Unexpected ${message.type} response for ${pending.operation}`,
      );
      pending.reject(error);
      this.fail(error);
      return;
    }
    if (pending.operation === "INIT") {
      this.transition("READY");
    } else if (pending.operation === "OPEN" || pending.operation === "SAVE") {
      this.transition("OPEN");
    }
    pending.resolve(message);
    if (pending.operation === "CLOSE") this.close();
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.close();
  }
}
