"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { OnlyOfficeAdapter } from "@/lib/onlyoffice/adapter";
import {
  getRemoteUpdatedAt,
  saveEncryptedDocument,
} from "@/lib/onlyoffice/documentCrypto";
import type { SaveStatus } from "@/components/editor/types";

/**
 * hooks/useAutoSave.ts
 *
 * The debounced, encrypt-on-save state machine that backs the document editor.
 * It never touches plaintext or keys itself — it asks the adapter to serialize
 * (`adapter.save()` → plaintext bytes) and hands those to
 * `saveEncryptedDocument`, which is the only thing that encrypts + uploads.
 *
 * Behaviour:
 *   - Edits call {@link notifyDirty}; a save fires `DEBOUNCE_MS` after the last
 *     edit. Ctrl/Cmd+S and the toolbar call {@link saveNow} for an immediate one.
 *   - Failures retry with exponential backoff up to `MAX_RETRIES`, then stop and
 *     leave the status on "error" for a manual retry.
 *   - Before overwriting, it re-reads the server `updatedAt`; if that diverged
 *     from our baseline by more than `CONFLICT_THRESHOLD_MS`, it surfaces
 *     "conflict" instead of clobbering. A manual save while in "conflict" forces
 *     the write (last-write-wins) — that's how the indicator's retry resolves it.
 *   - `beforeunload` warns when there are unsaved or in-flight edits. We do NOT
 *     sendBeacon a flush: encryption is async (Web Crypto) so it can't complete
 *     synchronously in the unload handler, and plaintext must never leave anyway.
 */

const DEBOUNCE_MS = 3000;
const CONFLICT_THRESHOLD_MS = 5000;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 30000;
const SAVED_LINGER_MS = 2500;

type TimerRef = { current: ReturnType<typeof setTimeout> | null };

function clearTimer(ref: TimerRef) {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

/** True when the remote copy advanced past our baseline by more than the threshold. */
function diverged(remote: string | null, baseline: string | null): boolean {
  if (!remote || !baseline) return false;
  const r = Date.parse(remote);
  const b = Date.parse(baseline);
  if (Number.isNaN(r) || Number.isNaN(b)) return false;
  return r - b > CONFLICT_THRESHOLD_MS;
}

interface UseAutoSaveOptions {
  fileId: string;
  getAdapter: () => OnlyOfficeAdapter | null;
  getDek: () => CryptoKey | null;
  /** Server `updatedAt` at load time; the conflict-detection baseline. */
  baselineUpdatedAt: string | null;
  /** Gate saves on the editor being ready and the document being editable. */
  enabled: boolean;
}

export interface AutoSaveHandle {
  status: SaveStatus;
  notifyDirty: () => void;
  saveNow: () => Promise<void>;
}

export function useAutoSave(opts: UseAutoSaveOptions): AutoSaveHandle {
  const { fileId, getAdapter, getDek, baselineUpdatedAt, enabled } = opts;

  const [status, setStatusState] = useState<SaveStatus>("idle");
  const statusRef = useRef<SaveStatus>("idle");

  const mountedRef = useRef(true);
  const setStatus = useCallback((s: SaveStatus) => {
    statusRef.current = s;
    if (mountedRef.current) setStatusState(s);
  }, []);

  const enabledRef = useRef(enabled);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const attemptRef = useRef(0);
  const baselineRef = useRef<string | null>(baselineUpdatedAt);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Latest-closure refs so timers and the adapter's onDirty fire against the
  // current props/getters without re-subscribing.
  const scheduleSaveRef = useRef<(delay: number) => void>(() => {});
  const runSaveRef = useRef<(force: boolean) => Promise<void>>(async () => {});

  // A fresh document (re)load resets the conflict baseline. Our own saves
  // advance baselineRef internally; this only fires when the prop changes.
  useEffect(() => {
    baselineRef.current = baselineUpdatedAt;
  }, [baselineUpdatedAt]);

  // Sync the latest props/getters into the refs after each commit (not during
  // render — that keeps react-hooks/refs happy). Timers and onDirty all fire
  // post-commit, so they observe the freshest closures.
  useEffect(() => {
    enabledRef.current = enabled;

    scheduleSaveRef.current = (delay: number) => {
      clearTimer(debounceTimer);
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        void runSaveRef.current(false);
      }, delay);
    };

    runSaveRef.current = async (force: boolean) => {
      if (!enabledRef.current) return;
      const adapter = getAdapter();
      const dek = getDek();
      if (!adapter || !dek) return;

      if (savingRef.current) {
        // A save is mid-flight — ask it to run once more when it settles.
        saveAgainRef.current = true;
        return;
      }

      clearTimer(retryTimer);
      clearTimer(lingerTimer);
      savingRef.current = true;
      setStatus("saving");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Conflict guard (skipped on an explicit force = last-write-wins).
        if (!force) {
          const remote = await getRemoteUpdatedAt(fileId, controller.signal);
          if (diverged(remote, baselineRef.current)) {
            savingRef.current = false;
            abortRef.current = null;
            setStatus("conflict");
            return;
          }
        }

        const bytes = await adapter.save();
        const result = await saveEncryptedDocument({
          fileId,
          plaintext: bytes,
          dek,
          signal: controller.signal,
        });

        baselineRef.current = result.updatedAt ?? baselineRef.current;
        attemptRef.current = 0;
        savingRef.current = false;
        abortRef.current = null;

        if (saveAgainRef.current) {
          // Edits arrived during the save; keep dirty and run again shortly.
          saveAgainRef.current = false;
          setStatus("dirty");
          scheduleSaveRef.current(DEBOUNCE_MS);
          return;
        }

        dirtyRef.current = false;
        setStatus("saved");
        lingerTimer.current = setTimeout(() => {
          lingerTimer.current = null;
          if (
            !dirtyRef.current &&
            !savingRef.current &&
            statusRef.current === "saved"
          ) {
            setStatus("idle");
          }
        }, SAVED_LINGER_MS);
      } catch (err) {
        savingRef.current = false;
        abortRef.current = null;
        if (controller.signal.aborted) return;
        void err;

        attemptRef.current += 1;
        setStatus("error");
        if (attemptRef.current <= MAX_RETRIES) {
          const delay = Math.min(
            BACKOFF_BASE_MS * 2 ** (attemptRef.current - 1),
            BACKOFF_CAP_MS,
          );
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            void runSaveRef.current(false);
          }, delay);
        }
        // After MAX_RETRIES the auto-retry loop stops; status stays "error" and
        // a manual saveNow() (which resets the counter) is the way forward.
      }
    };
  });

  const notifyDirty = useCallback(() => {
    if (!enabledRef.current) return;
    dirtyRef.current = true;
    // A known conflict needs explicit resolution — don't auto-retry into it.
    if (statusRef.current === "conflict") return;
    attemptRef.current = 0;
    clearTimer(retryTimer);
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    setStatus("dirty");
    scheduleSaveRef.current(DEBOUNCE_MS);
  }, [setStatus]);

  const saveNow = useCallback(async () => {
    if (!enabledRef.current) return;
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    clearTimer(debounceTimer);
    clearTimer(retryTimer);
    attemptRef.current = 0;
    // Saving while a conflict is showing means the user chose to overwrite.
    const force = statusRef.current === "conflict";
    await runSaveRef.current(force);
  }, []);

  // Mount lifecycle: beforeunload warning + teardown.
  useEffect(() => {
    mountedRef.current = true;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!enabledRef.current) return;
      if (dirtyRef.current || savingRef.current || saveAgainRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearTimer(debounceTimer);
      clearTimer(retryTimer);
      clearTimer(lingerTimer);
      abortRef.current?.abort();
    };
  }, []);

  // When disabled (editor not ready / read-only), stop any pending debounce so
  // a save can't fire against a torn-down adapter. In-flight saves are guarded
  // by enabledRef and finish writing on their own.
  useEffect(() => {
    if (!enabled) {
      clearTimer(debounceTimer);
      clearTimer(retryTimer);
    }
  }, [enabled]);

  return { status, notifyDirty, saveNow };
}
