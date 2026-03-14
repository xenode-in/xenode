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
import type { IPlan } from "@/models/PricingConfig";

export default function UpgradePlanModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [plans, setPlans] = useState<IPlan[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch plans from DB when modal is first opened
  useEffect(() => {
    if (!open || plans.length > 0) return;
    fetch("/api/admin/pricing/plans-public")
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setPlans(data.plans);
      })
      .catch(() => {});
  }, [open, plans.length]);

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
          {plans.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <span className="text-sm text-[#e8e4d9]/50">Loading plans…</span>
            </div>
          ) : (
            <PricingGrid plans={plans} campaign={null} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
