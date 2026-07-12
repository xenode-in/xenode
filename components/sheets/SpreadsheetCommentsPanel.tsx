"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, RotateCcw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  decryptWithShareKey,
  encryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { formatDate } from "@/lib/utils";

/**
 * Where a comment points inside the workbook. Included INSIDE the encrypted
 * payload, so the server never learns sheet names or cell references. The
 * shape is editor-agnostic on purpose (a future document editor can use its
 * own anchor fields).
 */
export interface CommentAnchor {
  sheetId?: string;
  sheetName?: string;
  ref?: string;
}

interface CommentPayload {
  body: string;
  anchor?: CommentAnchor;
}

interface RawComment {
  id: string;
  parentId: string | null;
  authorUserId: string;
  authorEmail: string | null;
  ciphertext: string;
  status: "open" | "resolved";
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  mine: boolean;
}

interface DecryptedComment extends RawComment {
  body: string;
  anchor?: CommentAnchor;
}

type ThreadFilter = "all" | "open" | "resolved";

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

async function decryptComment(raw: RawComment, dek: CryptoKey): Promise<DecryptedComment> {
  try {
    const plaintext = await decryptWithShareKey(raw.ciphertext, dek);
    const payload = JSON.parse(plaintext) as CommentPayload;
    return { ...raw, body: payload.body ?? "", anchor: payload.anchor };
  } catch {
    return { ...raw, body: "[unable to decrypt]" };
  }
}

/**
 * Google Sheets-style E2EE comments sidebar. Payloads are encrypted with the
 * file DEK so every participant (owner, org members, share recipients) can
 * read them while the server only relays ciphertext. Editor-agnostic: pass a
 * different `getSelectionAnchor`/`onJumpToAnchor` from other editors.
 */
export function SpreadsheetCommentsPanel({
  objectId,
  dek,
  canComment,
  scopedFetch,
  onClose,
  getSelectionAnchor,
  onJumpToAnchor,
  className,
  hideHeader,
}: {
  objectId: string;
  dek: CryptoKey;
  canComment: boolean;
  scopedFetch?: typeof fetch;
  onClose: () => void;
  getSelectionAnchor?: () => CommentAnchor | null;
  onJumpToAnchor?: (anchor: CommentAnchor) => void;
  className?: string;
  /** Hide the panel's own title row (when hosted inside a dialog with its own). */
  hideHeader?: boolean;
}) {
  const doFetch = scopedFetch ?? fetch;
  const [comments, setComments] = useState<DecryptedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [text, setText] = useState("");
  const [composeAnchor, setComposeAnchor] = useState<CommentAnchor | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readJson<{ comments: RawComment[] }>(
        await doFetch(`/api/objects/${objectId}/comments`),
      );
      setComments(await Promise.all(data.comments.map((c) => decryptComment(c, dek))));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId, dek]);

  useEffect(() => {
    void load();
  }, [load]);

  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parentId);
    const byParent = new Map<string, DecryptedComment[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
    }
    return roots
      .filter((root) => (filter === "all" ? true : root.status === filter))
      .map((root) => ({ root, replies: byParent.get(root.id) ?? [] }));
  }, [comments, filter]);

  const post = async (body: string, parentId: string | null, anchor?: CommentAnchor | null) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const payload: CommentPayload = { body: trimmed };
      if (anchor && (anchor.ref || anchor.sheetName)) payload.anchor = anchor;
      const ciphertext = await encryptWithShareKey(JSON.stringify(payload), dek);
      const data = await readJson<{ comment: RawComment }>(
        await doFetch(`/api/objects/${objectId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciphertext, parentId: parentId ?? undefined }),
        }),
      );
      setComments((prev) => [
        ...prev,
        { ...data.comment, body: trimmed, anchor: payload.anchor },
      ]);
      if (parentId) {
        setReplyText("");
        setReplyTo(null);
      } else {
        setText("");
        setComposeAnchor(null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  };

  const setThreadStatus = async (rootId: string, action: "resolve" | "reopen") => {
    setBusy(true);
    try {
      const data = await readJson<{ comment: RawComment }>(
        await doFetch(`/api/objects/${objectId}/comments/${rootId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      );
      setComments((prev) =>
        prev.map((c) =>
          c.id === rootId
            ? { ...c, status: data.comment.status, resolvedBy: data.comment.resolvedBy, resolvedAt: data.comment.resolvedAt }
            : c,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update comment");
    } finally {
      setBusy(false);
    }
  };

  const anchorChip = (anchor?: CommentAnchor) =>
    anchor && (anchor.sheetName || anchor.ref) ? (
      <button
        type="button"
        onClick={() => onJumpToAnchor?.(anchor)}
        className="mb-1 inline-flex max-w-full items-center gap-1 truncate rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        title="Jump to this location"
      >
        {[anchor.sheetName, anchor.ref].filter(Boolean).join(" · ")}
      </button>
    ) : null;

  const author = (c: DecryptedComment) => (c.mine ? "You" : c.authorEmail || "A participant");

  return (
    <aside className={className ?? "flex w-80 shrink-0 flex-col border-l border-border bg-background"}>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Comments</h2>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()} title="Refresh" disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close comments">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-border px-3 py-1.5">
        {(["all", "open", "resolved"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-2.5 py-0.5 text-xs capitalize transition-colors ${
              filter === value
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground hover:bg-secondary/60"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : threads.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filter === "all" ? "No comments yet." : `No ${filter} comments.`}
          </p>
        ) : (
          threads.map(({ root, replies }) => (
            <div
              key={root.id}
              className={`rounded-lg border border-border p-2.5 ${
                root.status === "resolved" ? "bg-secondary/30 opacity-75" : "bg-card"
              }`}
            >
              {anchorChip(root.anchor)}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{author(root)}</p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(root.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {root.status === "resolved" && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Resolved</Badge>
                  )}
                  {canComment && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={busy}
                      onClick={() => void setThreadStatus(root.id, root.status === "resolved" ? "reopen" : "resolve")}
                      title={root.status === "resolved" ? "Re-open thread" : "Resolve thread"}
                    >
                      {root.status === "resolved" ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{root.body}</p>

              {replies.length > 0 && (
                <div className="mt-2 space-y-2 border-l-2 border-border pl-2">
                  {replies.map((reply) => (
                    <div key={reply.id}>
                      <p className="text-[11px] font-medium">
                        {author(reply)}{" "}
                        <span className="font-normal text-muted-foreground">· {formatDate(reply.createdAt)}</span>
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm">{reply.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {canComment && root.status !== "resolved" && (
                replyTo === root.id ? (
                  <div className="mt-2 flex items-end gap-1.5">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void post(replyText, root.id);
                        }
                      }}
                      rows={2}
                      autoFocus
                      placeholder="Reply…"
                      className="flex-1 resize-none rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-sm outline-none focus:border-primary/50"
                    />
                    <Button size="icon" className="h-7 w-7" disabled={busy || !replyText.trim()} onClick={() => void post(replyText, root.id)} aria-label="Send reply">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setReplyTo(root.id); setReplyText(""); }}
                    className="mt-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    Reply
                  </button>
                )
              )}
            </div>
          ))
        )}
      </div>

      {canComment ? (
        <div className="border-t border-border p-3">
          {composeAnchor && (composeAnchor.sheetName || composeAnchor.ref) && (
            <p className="mb-1 truncate text-[10px] text-muted-foreground">
              Commenting on {[composeAnchor.sheetName, composeAnchor.ref].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="flex items-end gap-1.5">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setComposeAnchor(getSelectionAnchor?.() ?? null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void post(text, null, composeAnchor);
                }
              }}
              rows={2}
              placeholder="Add a comment…"
              className="flex-1 resize-none rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-sm outline-none focus:border-primary/50"
            />
            <Button size="icon" className="h-8 w-8" disabled={busy || !text.trim()} onClick={() => void post(text, null, composeAnchor)} aria-label="Send comment">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-border p-3 text-xs text-muted-foreground">
          You have view-only access — commenting is disabled.
        </p>
      )}
    </aside>
  );
}
