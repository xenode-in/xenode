"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCrypto } from "@/contexts/CryptoContext";
import { buildShareKey } from "@/lib/crypto/directShare";
import {
  decryptWithShareKey,
  encryptWithShareKey,
} from "@/lib/crypto/fileEncryption";
import { formatDate } from "@/lib/utils";

interface RawComment {
  id: string;
  authorUserId: string;
  authorEmail: string | null;
  ciphertext: string;
  createdAt: string;
  mine: boolean;
}

interface DecryptedComment extends RawComment {
  body: string;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

/**
 * E2EE comments on a direct-shared file. The comment body is encrypted with the
 * share key (derived by RSA-unwrapping `wrappedShareKey`), so the server only
 * ever holds ciphertext.
 */
export function FileCommentsDialog({
  shareId,
  wrappedShareKey,
  fileName,
  open,
  onOpenChange,
}: {
  shareId: string | null;
  wrappedShareKey: string | null;
  fileName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { privateKey, isUnlocked, setModalOpen } = useCrypto();
  const [shareKey, setShareKey] = useState<CryptoKey | null>(null);
  const [comments, setComments] = useState<DecryptedComment[]>([]);
  const [canComment, setCanComment] = useState(false);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    if (!shareId || !wrappedShareKey || !privateKey) return;
    setLoading(true);
    try {
      const key = await buildShareKey(wrappedShareKey, privateKey);
      setShareKey(key);
      const data = await readJson<{
        comments: RawComment[];
        canComment: boolean;
      }>(await fetch(`/api/direct-shares/${shareId}/comments`));
      setCanComment(data.canComment);
      const decrypted = await Promise.all(
        data.comments.map(async (c) => ({
          ...c,
          body: await decryptWithShareKey(c.ciphertext, key).catch(
            () => "[unable to decrypt]",
          ),
        })),
      );
      setComments(decrypted);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load comments",
      );
    } finally {
      setLoading(false);
    }
  }, [shareId, wrappedShareKey, privateKey]);

  useEffect(() => {
    if (!open) return;
    if (!isUnlocked) {
      setModalOpen(true);
      return;
    }
    void load();
  }, [open, isUnlocked, load, setModalOpen]);

  const post = async () => {
    const body = text.trim();
    if (!body || !shareId || !shareKey) return;
    setPosting(true);
    try {
      const ciphertext = await encryptWithShareKey(body, shareKey);
      const data = await readJson<{ comment: RawComment }>(
        await fetch(`/api/direct-shares/${shareId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciphertext }),
        }),
      );
      setComments((prev) => [...prev, { ...data.comment, body }]);
      setText("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to post comment",
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Comments
          </DialogTitle>
          <DialogDescription className="truncate">
            {fileName || "Shared file"} · encrypted for share participants
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No comments yet.
            </p>
          ) : (
            comments.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">
                    {c.mine ? "You" : c.authorEmail || "A participant"}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDate(c.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {c.body}
                </p>
              </div>
            ))
          )}
        </div>

        {canComment ? (
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void post();
                }
              }}
              rows={2}
              placeholder="Add a comment…"
              className="flex-1 resize-none rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <Button
              onClick={post}
              disabled={posting || !text.trim()}
              size="icon"
              aria-label="Send comment"
            >
              {posting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            You have view-only access — commenting is disabled.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
