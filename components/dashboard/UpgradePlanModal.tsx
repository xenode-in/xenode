"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import PricingGrid from "@/components/PricingGrid";
import type { IPlan, ICampaign } from "@/models/PricingConfig";

export default function UpgradePlanModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [plans, setPlans] = useState<IPlan[]>([]);
  const [campaign, setCampaign] = useState<ICampaign | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Always re-fetch fresh plans + campaign whenever the modal opens
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
  }, [open]); // re-runs every time modal opens — always fresh

  if (!mounted) {
    return <Button className="w-full sm:w-auto invisible">Upgrade Plan</Button>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          Upgrade Plan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[700px] max-h-[90vh] overflow-y-auto w-[90vw] p-0 bg-[#0c140e] border-[#1a2e1d]/50">
        <DialogTitle className="sr-only">Upgrade Plan</DialogTitle>
        <div className="pt-8">
          {loading || plans.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <span className="text-sm text-[#e8e4d9]/50">
                {loading ? "Loading plans…" : "No plans available"}
              </span>
            </div>
          ) : (
            <PricingGrid plans={plans} campaign={campaign} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
