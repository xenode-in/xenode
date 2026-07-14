"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, Check, Users2, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { StorageChart } from "@/components/dashboard/StorageChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  OrgPageHeader,
  OrgSectionCard,
  OrgStatTile,
  OrgLoading,
} from "@/components/organizations/org-ui";
import { cn, formatBytes } from "@/lib/utils";

interface PlanPricing { cycle: "monthly" | "yearly"; priceINR: number }
interface OrgPlan {
  slug: string;
  name: string;
  storage: string;
  maxSeats: number | null;
  pricing: PlanPricing[];
  features: string[];
}
interface BillingData {
  usage: {
    plan: string;
    storageLimitBytes: number | null;
    totalStorageBytes: number;
    seats: number;
    seatsUsed: number;
    pendingInvites: number;
    planExpiresAt: string | null;
    isGracePeriod: boolean;
  };
  subscription: { status: string; planSlug: string; billingCycle: string; currentPeriodEnd: string | null } | null;
  plans: OrgPlan[];
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

export function OrgBillingClient({ orgId }: { orgId: string }) {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [seatInput, setSeatInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await readJson<BillingData>(await fetch(`/api/orgs/${orgId}/billing`));
      setData(d);
      setSeatInput(String(d.usage.seats));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkout(planSlug: string) {
    setBusy(planSlug);
    try {
      const seats = Math.max(data?.usage.seatsUsed ?? 1, 1);
      const res = await readJson<{ shortUrl?: string }>(
        await fetch(`/api/orgs/${orgId}/billing/subscriptions/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planSlug, billingCycle: cycle, seats }),
        }),
      );
      if (res.shortUrl) {
        window.location.href = res.shortUrl;
        return;
      }
      toast.success("Checkout started");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout failed");
    } finally {
      setBusy(null);
    }
  }

  async function changeSeats() {
    const seats = Number(seatInput);
    if (!Number.isInteger(seats) || seats < 1) return toast.error("Enter a valid seat count");
    setBusy("seats");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/billing/seats`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seats }),
        }),
      );
      toast.success("Seats updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update seats");
    } finally {
      setBusy(null);
    }
  }

  if (loading || !data) return <OrgLoading />;

  const { usage, subscription, plans } = data;
  const hasSub = subscription && subscription.status === "active";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <OrgPageHeader title="Billing" description="Manage your organization plan, seats, and storage." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <OrgStatTile icon={CreditCard} label="Plan" value={<span className="capitalize">{usage.plan.replace("org-", "")}</span>} hint={hasSub ? subscription!.billingCycle : "no active subscription"} />
        <OrgStatTile icon={Users2} label="Seats" value={`${usage.seatsUsed}/${usage.seats}`} hint={usage.pendingInvites ? `${usage.pendingInvites} pending` : undefined} />
        <OrgStatTile icon={HardDrive} label="Storage" value={formatBytes(usage.totalStorageBytes)} hint={usage.storageLimitBytes === null ? "Unlimited" : `of ${formatBytes(usage.storageLimitBytes)}`} />
        <OrgStatTile icon={CreditCard} label="Status" value={<span className="capitalize">{subscription?.status ?? "free"}</span>} hint={usage.isGracePeriod ? "grace period" : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <OrgSectionCard title="Storage" icon={HardDrive}>
          <StorageChart usedBytes={usage.totalStorageBytes} totalBytes={usage.storageLimitBytes} />
        </OrgSectionCard>

        <OrgSectionCard title="Seats" icon={Users2}>
          <p className="mb-3 text-sm text-muted-foreground">
            {usage.seatsUsed} of {usage.seats} seats in use. Guests don&rsquo;t consume a seat.
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Purchased seats</label>
              <Input type="number" min={1} value={seatInput} onChange={(e) => setSeatInput(e.target.value)} />
            </div>
            <Button onClick={changeSeats} disabled={busy !== null || !hasSub} variant="outline">
              {busy === "seats" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
            </Button>
          </div>
          {!hasSub && <p className="mt-2 text-xs text-muted-foreground">Start a subscription below to change seats.</p>}
        </OrgSectionCard>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Plans</h2>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                cycle === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const price = plan.pricing.find((p) => p.cycle === cycle);
          const isCurrent = usage.plan === plan.slug;
          const selfServe = !!price;
          return (
            <div
              key={plan.slug}
              className={cn(
                "flex flex-col rounded-xl border bg-card p-5",
                isCurrent ? "border-primary ring-1 ring-primary/30" : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-foreground">{plan.name}</h3>
                {isCurrent && <Badge>Current</Badge>}
              </div>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {price ? `₹${price.priceINR}` : "Custom"}
                {price && <span className="text-xs font-normal text-muted-foreground">/{cycle === "yearly" ? "yr" : "mo"}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {plan.storage} · {plan.maxSeats === null ? "Unlimited seats" : `${plan.maxSeats} seats`}
              </p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-4 w-full"
                variant={isCurrent ? "outline" : "default"}
                disabled={busy !== null || isCurrent || !selfServe}
                onClick={() => checkout(plan.slug)}
              >
                {busy === plan.slug ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isCurrent ? "Current plan" : selfServe ? "Choose plan" : "Contact sales"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
