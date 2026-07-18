/**
 * PricingManager.tsx — Admin panel component for managing plan prices.
 *
 * Only base plan pricing lives here. Promotional campaigns (auto-applied) live
 * in `/admin/dashboard/billing/campaigns`. User-typed coupon codes live in
 * `/admin/dashboard/coupons`.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tag, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { IPlan } from "@/models/PricingConfig";
import { getYearlySavingsPercent } from "@/lib/pricing/pricingService";

interface Props {
  initialConfig: { plans: IPlan[] };
}

/** Safely read a specific cycle's price from a plan's pricing array */
function getPriceForCycle(plan: IPlan, cycle: "monthly" | "yearly"): number {
  return plan.pricing?.find((p) => p.cycle === cycle)?.priceINR ?? 0;
}

/** Return a new pricing[] with a specific cycle's price updated */
function setPriceForCycle(
  pricing: IPlan["pricing"],
  cycle: "monthly" | "yearly",
  newPrice: number
): IPlan["pricing"] {
  const exists = pricing.some((p) => p.cycle === cycle);
  if (exists) {
    return pricing.map((p) =>
      p.cycle === cycle ? { ...p, priceINR: newPrice } : p
    );
  }
  return [...pricing, { cycle, priceINR: newPrice }];
}

export function PricingManager({ initialConfig }: Props) {
  const [plans, setPlans] = useState<IPlan[]>(initialConfig.plans ?? []);
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<IPlan | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Plan helpers ──────────────────────────────────────────────

  function startEditPlan(p: IPlan) {
    setEditingPlan(p.slug);
    setPlanDraft({ ...p, pricing: [...p.pricing] });
  }

  function cancelEditPlan() {
    setEditingPlan(null);
    setPlanDraft(null);
  }

  async function savePlan() {
    if (!planDraft) return;
    const updated = plans.map((p) =>
      p.slug === planDraft.slug ? planDraft : p
    );
    setSaving(true);
    const res = await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plans: updated }),
    });
    setSaving(false);
    if (res.ok) {
      const json = await res.json();
      setPlans(json.config.plans ?? updated);
      cancelEditPlan();
      toast.success(`${planDraft.name} updated`);
    } else {
      toast.error("Failed to save plan");
    }
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-10">

      {/* ── PLANS SECTION ─────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <Tag className="w-4 h-4 text-zinc-400" /> Plan Prices
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const monthlyPrice = getPriceForCycle(plan, "monthly");
            const yearlyPrice = getPriceForCycle(plan, "yearly");
            const savings = getYearlySavingsPercent(plan.pricing);

            return (
              <Card key={plan.slug} className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white text-sm font-semibold">
                      {plan.name}
                    </CardTitle>
                    {editingPlan !== plan.slug && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-zinc-400 hover:text-white"
                        onClick={() => startEditPlan(plan)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  <CardDescription className="text-zinc-600 text-xs">
                    slug: {plan.slug} · {plan.storage}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  {editingPlan === plan.slug && planDraft ? (
                    // ── EDIT MODE ──────────────────────────────
                    <>
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs text-zinc-400">Plan Label</Label>
                          <Input
                            value={planDraft.name}
                            onChange={(e) =>
                              setPlanDraft({ ...planDraft, name: e.target.value })
                            }
                            className="h-8 text-sm bg-zinc-800 border-zinc-700 text-white mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-zinc-400">Storage Label</Label>
                          <Input
                            value={planDraft.storage}
                            onChange={(e) =>
                              setPlanDraft({ ...planDraft, storage: e.target.value })
                            }
                            className="h-8 text-sm bg-zinc-800 border-zinc-700 text-white mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-zinc-400">Storage Limit (GB)</Label>
                          <Input
                            type="number"
                            value={Math.round(planDraft.storageLimitBytes / (1024 ** 3))}
                            onChange={(e) =>
                              setPlanDraft({
                                ...planDraft,
                                storageLimitBytes: Number(e.target.value) * 1024 ** 3,
                              })
                            }
                            className="h-8 text-sm bg-zinc-800 border-zinc-700 text-white mt-1"
                          />
                        </div>

                        {/* ── Monthly price ── */}
                        <div>
                          <Label className="text-xs text-zinc-400">Monthly Price (₹/mo)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={getPriceForCycle(planDraft, "monthly")}
                            onChange={(e) =>
                              setPlanDraft({
                                ...planDraft,
                                pricing: setPriceForCycle(
                                  planDraft.pricing,
                                  "monthly",
                                  Number(e.target.value)
                                ),
                              })
                            }
                            className="h-8 text-sm bg-zinc-800 border-zinc-700 text-white mt-1"
                          />
                        </div>

                        {/* ── Yearly price ── */}
                        <div>
                          <Label className="text-xs text-zinc-400">Yearly Price (₹/yr)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={getPriceForCycle(planDraft, "yearly")}
                            onChange={(e) =>
                              setPlanDraft({
                                ...planDraft,
                                pricing: setPriceForCycle(
                                  planDraft.pricing,
                                  "yearly",
                                  Number(e.target.value)
                                ),
                              })
                            }
                            className="h-8 text-sm bg-zinc-800 border-zinc-700 text-white mt-1"
                          />
                          <p className="text-[10px] text-zinc-600 mt-1">
                            Tip: set to monthly × 10 for ~17% saving
                          </p>
                        </div>

                        <div>
                          <Label className="text-xs text-zinc-400">Features (one per line)</Label>
                          <textarea
                            rows={4}
                            value={planDraft.features.join("\n")}
                            onChange={(e) =>
                              setPlanDraft({
                                ...planDraft,
                                features: e.target.value
                                  .split("\n")
                                  .map((f) => f.trim())
                                  .filter(Boolean),
                              })
                            }
                            className="w-full mt-1 rounded-md bg-zinc-800 border border-zinc-700 text-white text-sm px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-zinc-500"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={!!planDraft.isPopular}
                            onCheckedChange={(v) =>
                              setPlanDraft({ ...planDraft, isPopular: v })
                            }
                          />
                          <Label className="text-xs text-zinc-400">Mark as Popular</Label>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          className="h-7 text-xs flex-1"
                          onClick={savePlan}
                          disabled={saving}
                        >
                          <Save className="w-3 h-3 mr-1" />
                          {saving ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-zinc-400"
                          onClick={cancelEditPlan}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    // ── VIEW MODE ──────────────────────────────
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Monthly</span>
                        <span className="text-white font-semibold">₹{monthlyPrice}/mo</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Yearly</span>
                        <span className="text-white font-semibold">
                          ₹{yearlyPrice}/yr
                          {savings && savings > 0 && (
                            <span className="ml-1.5 text-[10px] text-primary font-normal">
                              saves {savings}%
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Storage</span>
                        <span className="text-zinc-300">{plan.storage}</span>
                      </div>
                      <Separator className="bg-zinc-800 my-1" />
                      <ul className="space-y-1">
                        {plan.features.map((f, i) => (
                          <li key={i} className="text-xs text-zinc-500 flex items-start gap-1">
                            <span className="text-zinc-600 shrink-0">·</span> {f}
                          </li>
                        ))}
                      </ul>
                      {plan.isPopular && (
                        <Badge variant="secondary" className="text-xs mt-1">Most Popular</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
