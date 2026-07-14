"use client";

import { useState } from "react";
import { Check, Loader2, MessageSquare, Pencil, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { normalizeShareRole } from "@/lib/orgs/shareRoles";

/**
 * "Request access" (Google-Drive style) for a share recipient who currently
 * holds only `viewer`. Lets them ask the owner to upgrade to commenter/editor.
 * Renders nothing when the caller already has comment/edit access.
 */
export function ShareAccessRequestButton({
  shareId,
  currentRole,
  size = "sm",
  variant = "outline",
}: {
  shareId: string;
  currentRole: string;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "ghost" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  if (normalizeShareRole(currentRole) !== "viewer") return null;

  const request = async (requestedRole: "commenter" | "editor") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/direct-shares/${shareId}/access-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to request access");
      setRequested(true);
      toast.success("Access requested — the owner will review it");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to request access");
    } finally {
      setBusy(false);
    }
  };

  if (requested) {
    return (
      <Button variant="ghost" size={size} disabled className="text-muted-foreground">
        <Check className="h-4 w-4" />
        Access requested
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldPlus className="h-4 w-4" />
          )}
          Request access
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => request("commenter")}>
          <MessageSquare className="h-4 w-4" />
          Request comment access
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => request("editor")}>
          <Pencil className="h-4 w-4" />
          Request edit access
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
