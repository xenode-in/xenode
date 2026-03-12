"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import PricingComparison from "@/components/PricingComparison";

export default function UpgradePlanModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
          <PricingComparison />
        </div>
      </DialogContent>
    </Dialog>
  );
}
