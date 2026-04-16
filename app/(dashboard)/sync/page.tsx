"use client";

import { useEffect } from "react";
import { loadCachedKeys } from "@/lib/crypto/keyCache";

/**
 * Key Sync Relay Page
 * This page is loaded in a hidden iframe by subdomains (like docs.xenode.in) 
 * to securely retrieve E2EE keys from the main domain's host-only storage.
 */
export default function KeySyncPage() {
  useEffect(() => {
    // Only allow trusted origins to request keys
    const TRUSTED_ORIGINS = [
      "https://docs.xenode.in",
      "http://docs.localhost:3000",
      "https://admin.xenode.in"
    ];

    const handleMessage = async (event: MessageEvent) => {
      // 1. Verify Origin
      const isTrusted = TRUSTED_ORIGINS.some(origin => 
        event.origin === origin || 
        (event.origin.startsWith("http://docs.localhost") && origin.startsWith("http://docs.localhost"))
      );
      
      if (!isTrusted) {
        console.warn("[KeyRelay] Rejected message from untrusted origin:", event.origin);
        return;
      }

      // 2. Handle Request
      if (event.data?.type === "XENODE_GET_KEYS") {
        try {
          const keys = await loadCachedKeys();
          if (keys) {
            // We can transfer CryptoKeys directly via postMessage in modern browsers
            event.source?.postMessage({
              type: "XENODE_KEYS_RELAY",
              keys: {
                privateKey: keys.privateKey,
                publicKey: keys.publicKey,
                metadataKey: keys.metadataKey
              }
            }, { targetOrigin: event.origin } as WindowPostMessageOptions);
          } else {
            event.source?.postMessage({ type: "XENODE_KEYS_NOT_FOUND" }, { targetOrigin: event.origin } as WindowPostMessageOptions);
          }
        } catch (err) {
          console.error("[KeyRelay] Error relaying keys:", err);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    
    // Signal that we are ready
    if (window.parent !== window) {
      window.parent.postMessage({ type: "XENODE_SYNC_READY" }, "*");
    }

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null; // Invisible page
}
