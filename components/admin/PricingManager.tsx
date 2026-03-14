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

type Campaign = ICampaign | null;

interface Props {
  initialConfig: { plans: IPlan[]; campaign: Campaign };
}

// Safely converts any date value (Date object or ISO string) to YYYY-MM-DD
const formatDate = (d: string | Date) =>
  new Date(d).toISOString().slice(0, 10);

// Normalizes a raw campaign from the API response (dates may be strings)
function normalizeCampaign(raw: Campaign): Campaign {
  if (!raw) return null;
  return {
    ...raw,
    startDate: new Date(raw.startDate),
    endDate: new Date(raw.endDate),
  };
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
  });

  const [saving, setSaving] = useState(false);

  // ── Plan helpers ──────────────────────────────────────────────

  function startEditPlan(p: IPlan) {
    setEditingPlan(p.slug);
    setPlanDraft({ ...p });
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
      // Use API response as source of truth to stay in sync with DB
      setPlans(json.config.plans ?? updated);
      // Also sync campaign in case server normalized something
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
      // Normalize dates from API response before storing in state
      setCampaign(normalizeCampaign(json.config.campaign ?? null));
      // Also sync plans in case server normalized something
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
          {plans.map((plan) => (
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
                      <div>
                        <Label className="text-xs text-zinc-400">Price / month (₹)</Label>
                        <Input
                          type="number"
                          value={planDraft.priceINR}
                          onChange={(e) =>
                            setPlanDraft({ ...planDraft, priceINR: Number(e.target.value) })
                          }
                          className="h-8 text-sm bg-zinc-800 border-zinc-700 text-white mt-1"
                        />
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
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Price</span>
                      <span className="text-white font-semibold">₹{plan.priceINR}/mo</span>
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
          ))}
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
