"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * "Upgrade Plan" button — navigates to the full /plans page.
 * Previously opened a Dialog (too cramped for 4-col grid).
 */
export default function UpgradePlanModal() {
  const router = useRouter();
  return (
    <Button
      className="w-full sm:w-auto"
      onClick={() => router.push("/plans")}
    >
      Upgrade Plan
    </Button>
  );
}
