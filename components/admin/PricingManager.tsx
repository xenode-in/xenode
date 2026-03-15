/**
 * PricingManager.tsx — Admin panel component for managing pricing.
 *
 * CHANGES (multi-cycle refactor):
 *  - Replaced single `priceINR` input with separate Monthly Price + Yearly Price inputs.
 *  - Display view shows both monthly and yearly prices per plan card.
 *  - Uses pricing[] array shape from the refactored IPlan interface.
 *  - All price logic (savings %, etc.) imported from pricingService.
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
import { Tag, Pencil, Save, X, Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import type { IPlan, ICampaign } from "@/models/PricingConfig";
import { getYearlySavingsPercent } from "@/lib/pricing/pricingService";

type Campaign = ICampaign | null;

interface Props {
  initialConfig: { plans: IPlan[]; campaign: Campaign };
}

const formatDate = (d: string | Date) =>
  new Date(d).toISOString().slice(0, 10);

function normalizeCampaign(raw: Campaign): Campaign {
  if (!raw) return null;
  return {
    ...raw,
    startDate: new Date(raw.startDate),
    endDate: new Date(raw.endDate),
  };
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

  const [campaign, setCampaign] = useState<Campaign>(
    normalizeCampaign(initialConfig.campaign ?? null)
  );
  const [editingCampaign, setEditingCampaign] = useState(false);
  const [campDraft, setCampDraft] = useState({
    name: "",
    discountPercent: 10,
    startDate: formatDate(new Date()),
    endDate: formatDate(new Date(Date.now() + 7 * 86400000)),
    isActive: true,
    badge: "🎉 Sale",
    discountDuration: "forever" as "forever" | "limited",
    discountCycles: 1 as number | null,
    targetAudience: "all" as "all" | "free_only",
  });

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
      setCampaign(normalizeCampaign(json.config.campaign ?? null));
      cancelEditPlan();
      toast.success(`${planDraft.name} updated`);
    } else {
      toast.error("Failed to save plan");
    }
  }

  // ── Campaign helpers ──────────────────────────────────────────

  async function saveCampaign(data: typeof campDraft | null) {
    setSaving(true);
    const res = await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign: data }),
    });
    setSaving(false);
    if (res.ok) {
      const json = await res.json();
      setCampaign(normalizeCampaign(json.config.campaign ?? null));
      setPlans(json.config.plans ?? plans);
      setEditingCampaign(false);
      toast.success(data ? "Campaign saved" : "Campaign removed");
    } else {
      toast.error("Failed to save campaign");
    }
  }

  async function toggleCampaignActive(active: boolean) {
    if (!campaign) return;
    await saveCampaign({
      ...campaign,
      isActive: active,
      startDate: formatDate(campaign.startDate),
      endDate: formatDate(campaign.endDate),
    });
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

      {/* ── CAMPAIGN SECTION ──────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-zinc-400" /> Campaign
        </h2>

        {campaign && !editingCampaign ? (
          <Card className="bg-zinc-900 border-zinc-800 max-w-2xl">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold">{campaign.name}</span>
                    <Badge
                      variant={campaign.isActive ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {campaign.isActive ? "Active" : "Paused"}
                    </Badge>
                    {campaign.badge && (
                      <span className="text-sm">{campaign.badge}</span>
                    )}
                  </div>
                  <p className="text-zinc-400 text-sm mt-1">
                    {campaign.discountPercent}% discount ·{" "}
                    {formatDate(campaign.startDate)} → {formatDate(campaign.endDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={campaign.isActive}
                    onCheckedChange={toggleCampaignActive}
                    disabled={saving}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-zinc-700 text-zinc-300 hover:text-white"
                    onClick={() => {
                      setCampDraft({
                        ...campaign,
                        startDate: formatDate(campaign.startDate),
                        endDate: formatDate(campaign.endDate),
                        discountDuration: campaign.discountDuration || "forever",
                        discountCycles: campaign.discountCycles || 1,
                        targetAudience: campaign.targetAudience || "all",
                      });
                      setEditingCampaign(true);
                    }}
                  >
                    <Pencil className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    onClick={() => saveCampaign(null)}
                    disabled={saving}
                  >
                    <X className="w-3 h-3 mr-1" /> Remove
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-zinc-900 border-zinc-800 max-w-2xl">
            <CardContent className="pt-5">
              {!editingCampaign ? (
                <div className="text-center py-8">
                  <p className="text-zinc-500 text-sm mb-3">No campaign running</p>
                  <Button
                    size="sm"
                    onClick={() => setEditingCampaign(true)}
                    className="gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create Campaign
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-zinc-400">Campaign Name</Label>
                      <Input
                        value={campDraft.name}
                        onChange={(e) =>
                          setCampDraft({ ...campDraft, name: e.target.value })
                        }
                        placeholder="e.g. Launch Week Sale"
                        className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-zinc-400">Badge Text</Label>
                      <Input
                        value={campDraft.badge}
                        onChange={(e) =>
                          setCampDraft({ ...campDraft, badge: e.target.value })
                        }
                        placeholder="e.g. 🎉 Launch Sale"
                        className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-zinc-400">Discount %</Label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={campDraft.discountPercent}
                        onChange={(e) =>
                          setCampDraft({
                            ...campDraft,
                            discountPercent: Number(e.target.value),
                          })
                        }
                        className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                      />
                    </div>
                    <div className="flex items-center gap-3 pt-5">
                      <Switch
                        checked={campDraft.isActive}
                        onCheckedChange={(v) =>
                          setCampDraft({ ...campDraft, isActive: v })
                        }
                      />
                      <Label className="text-xs text-zinc-400">Active on save</Label>
                    </div>
                    <div>
                      <Label className="text-xs text-zinc-400">Duration</Label>
                      <select
                        value={campDraft.discountDuration}
                        onChange={(e) =>
                          setCampDraft({
                            ...campDraft,
                            discountDuration: e.target.value as "forever" | "limited",
                          })
                        }
                        className="mt-1 flex h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
                      >
                        <option value="forever">Forever (Lifetime lock-in)</option>
                        <option value="limited">Limited Billing Cycles</option>
                      </select>
                    </div>
                    {campDraft.discountDuration === "limited" && (
                      <div>
                        <Label className="text-xs text-zinc-400">Cycles to apply discount</Label>
                        <Input
                          type="number"
                          min={1}
                          value={campDraft.discountCycles || 1}
                          onChange={(e) =>
                            setCampDraft({
                              ...campDraft,
                              discountCycles: Number(e.target.value),
                            })
                          }
                          className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                        />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs text-zinc-400">Target Audience</Label>
                      <select
                        value={campDraft.targetAudience}
                        onChange={(e) =>
                          setCampDraft({
                            ...campDraft,
                            targetAudience: e.target.value as "all" | "free_only",
                          })
                        }
                        className="mt-1 flex h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
                      >
                        <option value="all">All Users</option>
                        <option value="free_only">Free Users Only (Upgrades)</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-zinc-400">Start Date</Label>
                      <Input
                        type="date"
                        value={campDraft.startDate}
                        onChange={(e) =>
                          setCampDraft({ ...campDraft, startDate: e.target.value })
                        }
                        className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-zinc-400">End Date</Label>
                      <Input
                        type="date"
                        value={campDraft.endDate}
                        onChange={(e) =>
                          setCampDraft({ ...campDraft, endDate: e.target.value })
                        }
                        className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={() => saveCampaign(campDraft)}
                      disabled={saving || !campDraft.name}
                      className="gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving ? "Saving…" : "Save Campaign"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-zinc-400 hover:text-white"
                      onClick={() => setEditingCampaign(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
