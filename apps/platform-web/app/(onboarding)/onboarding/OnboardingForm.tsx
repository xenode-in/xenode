"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { consumePostAuthRedirect } from "@/lib/postAuthRedirect";
import type { IPlan } from "@/models/PricingConfig";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

const ACCOUNTS_ORIGIN =
  process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";

export function OnboardingForm() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [encryptByDefault, setEncryptByDefault] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState("free");
  const [plans, setPlans] = useState<IPlan[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void fetch("/api/admin/pricing/plans-public")
      .then((response) => response.json())
      .then((payload: { plans?: IPlan[] }) => setPlans(payload.plans ?? []))
      .catch(() => setPlans([]));
  }, []);

  function completeOnboarding() {
    startTransition(async () => {
      try {
        const profileResponse = await fetch("/api/me", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ onboarded: true, encryptByDefault }),
        });
        if (!profileResponse.ok) {
          const payload = (await profileResponse.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? "Failed to save preferences");
        }
        const usageResponse = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!usageResponse.ok) {
          const payload = (await usageResponse.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? "Failed to initialize storage quota");
        }
        if (selectedPlan !== "free") {
          router.push(`/checkout?plan=${encodeURIComponent(selectedPlan)}`);
        } else {
          router.push(consumePostAuthRedirect() || "/dashboard");
        }
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Onboarding failed");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up Xenode Drive</CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose your Drive preferences. Vault creation, recovery, and account
          security now live in Xenode Accounts.
        </p>
      </CardHeader>
      <CardContent className="space-y-7">
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="font-medium">Vault v2 protects every product</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create or recover your Account Root Key in Accounts. Drive only
                receives its one-time ProductSpaceKey handoff.
              </p>
              <a
                href={`${ACCOUNTS_ORIGIN}/security/vault`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Manage encrypted Vault <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Theme</h2>
          <div className="flex flex-wrap gap-2">
            {(["light", "dark", "system"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={theme === value ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-between gap-4 rounded-xl border p-4">
          <div>
            <h2 className="text-sm font-medium">Encrypt uploads by default</h2>
            <p className="text-xs text-muted-foreground">
              Encryption happens in this browser before upload.
            </p>
          </div>
          <Switch checked={encryptByDefault} onCheckedChange={setEncryptByDefault} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Plan</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSelectedPlan("free")}
              className={`rounded-xl border p-3 text-left ${selectedPlan === "free" ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <span className="font-medium">Free</span>
            </button>
            {plans.map((plan) => (
              <button
                key={plan.slug}
                type="button"
                onClick={() => setSelectedPlan(plan.slug)}
                className={`rounded-xl border p-3 text-left ${selectedPlan === plan.slug ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="font-medium">{plan.name}</span>
              </button>
            ))}
          </div>
        </section>

        <Button
          type="button"
          className="w-full"
          disabled={isPending}
          onClick={completeOnboarding}
        >
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {selectedPlan === "free" ? "Open Drive" : "Continue to checkout"}
        </Button>
      </CardContent>
    </Card>
  );
}
