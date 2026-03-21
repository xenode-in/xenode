"use client";

import { useState, useEffect } from "react";
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
  Lock,
} from "lucide-react";
import { useCrypto } from "@/contexts/CryptoContext";
import { decryptMetadataString, buildAad } from "@/lib/crypto/fileEncryption";
import { CRYPTO_VERSION } from "@/lib/crypto/utils";

interface RawShareLink {
  _id: string;
  token: string;
  objectId: {
    _id: string;
    key: string;
    size: number;
    contentType: string;
    isEncrypted?: boolean;
    encryptedName?: string;
    bucketId: string;
  };
  bucketId?: {
    name: string;
  };
  createdBy: string;
  expiresAt?: string;
  isPasswordProtected: boolean;
  createdAt: string;
}

export default function SharedWithMePage() {
  const [links, setLinks] = useState<RawShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({});
  const { isUnlocked, metadataKey } = useCrypto() as any;

  const fetchLinks = async () => {
    try {
      const res = await fetch("/api/share/shared-with-me");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch links");
      setLinks(data.shareLinks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  useEffect(() => {
    if (!isUnlocked) {
      setDecryptedNames({});
      return;
    }

    const decryptNames = async () => {
      const newNames: Record<string, string> = {};
      for (const link of links) {
        if (link.objectId.isEncrypted && link.objectId.encryptedName) {
          try {
            const aad = buildAad({ 
              userId: link.createdBy, 
              bucketId: link.objectId.bucketId, 
              objectKey: link.objectId.key, 
              version: CRYPTO_VERSION 
            });
            const name = await decryptMetadataString(link.objectId.encryptedName, metadataKey, aad);
            newNames[link._id] = name;
          } catch (e) {
            console.error("Failed to decrypt name", e);
          }
        }
      }
      setDecryptedNames((prev) => ({ ...prev, ...newNames }));
    };

    decryptNames();
  }, [links, isUnlocked]);

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
          Files that other users have explicitly shared with your account
        </p>
      </div>

      {links.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center mt-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No files shared with you</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            When someone explicitly adds your email to a shared file, it will
            appear here.
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
                <TableHead className="hidden md:table-cell">Expires</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => {
                const isExpired =
                  link.expiresAt && new Date(link.expiresAt) < new Date();
                const displayName =
                  decryptedNames[link._id] ||
                  link.objectId.encryptedName ||
                  link.objectId.key.split("/").pop() ||
                  link.objectId.key;

                return (
                  <TableRow key={link._id}>
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
                            {formatBytes(link.objectId.size)} •{" "}
                            {new Date(link.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {link.createdBy}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {link.isPasswordProtected && (
                          <Badge
                            variant="outline"
                            className="text-amber-500 border-amber-500/20 bg-amber-500/10 px-1 py-0 h-5"
                          >
                            <Lock className="h-3 w-3 mr-1" /> Pass
                          </Badge>
                        )}
                        {link.objectId.isEncrypted && (
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
                      {link.expiresAt ? (
                        <span
                          className={`text-sm ${isExpired ? "text-destructive" : ""}`}
                        >
                          {new Date(link.expiresAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!isExpired}
                        asChild
                      >
                        <a
                          href={`/shared/${link.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open <ExternalLink className="ml-2 h-3 w-3" />
                        </a>
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
