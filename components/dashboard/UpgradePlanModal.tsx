"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PricingGrid from "@/components/PricingGrid";
import type { IPlan, ICampaign } from "@/models/PricingConfig";

function PricingSkeletons() {
  return (
    <div className="grid gap-5 px-5 pb-6 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-10 w-20" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-3.5 w-full" />
            ))}
          </div>
          <Skeleton className="h-10 w-full mt-4" />
        </div>
      ))}
    </div>
  );
}

export default function UpgradePlanModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [plans, setPlans] = useState<IPlan[]>([]);
  const [campaign, setCampaign] = useState<ICampaign | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/admin/pricing/plans-public")
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setPlans(data.plans);
        setCampaign(data.campaign ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  if (!mounted) {
    return <Button className="w-full sm:w-auto invisible">Upgrade Plan</Button>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">Upgrade Plan</Button>
      </DialogTrigger>

      <DialogContent
        className={[
          "w-[95vw] max-w-5xl p-0",
          "bg-background border-border",
          "max-h-[92vh] overflow-y-auto",
          "rounded-2xl",
        ].join(" ")}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-4 backdrop-blur-sm">
          <div>
            <DialogTitle className="text-base font-semibold text-foreground">
              Choose Your Plan
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              Upgrade to unlock more storage and features.
            </DialogDescription>
          </div>
        </div>

        {/* Body */}
        <div className="pt-4">
          {loading ? (
            <PricingSkeletons />
          ) : plans.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <span className="text-sm text-muted-foreground">No plans available.</span>
            </div>
          ) : (
            <PricingGrid plans={plans} campaign={campaign} compact />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
