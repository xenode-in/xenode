"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBytes } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Loader2,
  Users,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptWithShareKey } from "@/lib/crypto/fileEncryption";
import { fromB64 } from "@/lib/crypto/utils";

interface DirectShare {
  _id: string;
  objectId: {
    _id: string;
    key: string;
    size: number;
    contentType: string;
    isEncrypted?: boolean;
  };
  owner?: {
    id: string;
    name?: string;
    email?: string;
  } | null;
  recipient?: {
    recipientUserId: string;
    recipientEmail: string;
    wrappedShareKey: string;
    accessType: "view" | "download";
    downloadCount: number;
  };
  shareEncryptedName?: string;
  createdAt: string;
}

async function decryptSharedName(
  shareEncryptedName: string,
  wrappedShareKey: string,
  privateKey: CryptoKey,
) {
  const rawShareKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromB64(wrappedShareKey).buffer as ArrayBuffer,
  );

  const shareKey = await crypto.subtle.importKey(
    "raw",
    rawShareKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  return decryptWithShareKey(shareEncryptedName, shareKey);
}

export default function SharedWithMePage() {
  const [shares, setShares] = useState<DirectShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>(
    {},
  );
  const { isUnlocked, privateKey } = useCrypto();

  useEffect(() => {
    const fetchShares = async () => {
      try {
        const res = await fetch("/api/direct-shares/shared-with-me");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch shares");
        setShares(data.directShares || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load shares");
      } finally {
        setLoading(false);
      }
    };

    fetchShares();
  }, []);

  useEffect(() => {
    if (!isUnlocked || !privateKey) {
      setDecryptedNames({});
      return;
    }

    const run = async () => {
      const nextNames: Record<string, string> = {};

      for (const share of shares) {
        if (
          share.objectId.isEncrypted &&
          share.shareEncryptedName &&
          share.recipient?.wrappedShareKey
        ) {
          try {
            nextNames[share._id] = await decryptSharedName(
              share.shareEncryptedName,
              share.recipient.wrappedShareKey,
              privateKey,
            );
          } catch (decryptError) {
            console.error("Failed to decrypt direct share name", decryptError);
          }
        }
      }

      setDecryptedNames(nextNames);
    };

    run();
  }, [shares, isUnlocked, privateKey]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">
        <AlertCircle className="mr-2 h-5 w-5" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Shared with me</h1>
        <p className="text-muted-foreground">
          Authenticated direct shares sent to your Xenode account
        </p>
      </div>

      {shares.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center mt-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No files shared with you</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            Files shared directly to your account will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>File</TableHead>
                <TableHead>Shared By</TableHead>
                <TableHead>Security</TableHead>
                <TableHead className="hidden md:table-cell">Access</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shares.map((share) => {
                const displayName =
                  decryptedNames[share._id] ||
                  share.objectId.key.split("/").pop() ||
                  share.objectId.key;

                return (
                  <TableRow key={share._id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate font-medium">
                            {displayName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(share.objectId.size)} •{" "}
                            {new Date(share.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {share.owner?.name || share.owner?.email || "Unknown"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          Direct Share
                        </Badge>
                        {share.objectId.isEncrypted && (
                          <Badge
                            variant="outline"
                            className="text-green-500 border-green-500/20 bg-green-500/10 px-1 py-0 h-5"
                          >
                            E2EE
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-sm text-muted-foreground capitalize">
                        {share.recipient?.accessType || "download"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/shared-with-me/${share._id}`}>
                          Open <ExternalLink className="ml-2 h-3 w-3" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
