import type { CollaborationContext, SpreadsheetCollaborationAdapter } from "./types";

export class NoopSpreadsheetCollaborationAdapter implements SpreadsheetCollaborationAdapter {
  async connect(context: CollaborationContext): Promise<void> { void context; /* Encrypted Yjs provider connects here later. */ }
  async disconnect(): Promise<void> {}
  async publishUpdate(update: Uint8Array): Promise<void> { void update; /* Never send placeholder plaintext socket events. */ }
  subscribe(handler: (update: Uint8Array) => void): () => void { void handler; return () => {}; }
}

