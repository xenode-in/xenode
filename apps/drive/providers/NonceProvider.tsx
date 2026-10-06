"use client";
import { createContext, useContext, type ReactNode } from "react";
const NonceContext = createContext<string | undefined>(undefined);
export function NonceProvider({ nonce, children }: { nonce?: string; children: ReactNode }) {
  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>;
}
export function useScriptNonce() { return useContext(NonceContext); }
