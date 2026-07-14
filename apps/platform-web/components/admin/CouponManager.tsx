"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, X, Save } from "lucide-react";
import { toast } from "sonner";

interface Coupon {
  id: string;
  code: string;
  type: "global" | "user";
  targetUserId: string | null;
  discountType: "percent" | "flat";
  discountValue: number;
  maxUses: number;
  perUserLimit: number;
  usedCount: number;
  applicablePlans: string[];
  razorpayOfferId: string | null;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

const emptyForm = {
  code: "",
  type: "global" as "global" | "user",
  targetUserId: "",
  discountType: "percent" as "percent" | "flat",
  discountValue: 10,
  maxUses: 0,
  perUserLimit: 1,
  applicablePlans: "",
  razorpayOfferId: "",
  validFrom: new Date().toISOString().slice(0, 10),
  validTo: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  isActive: true,
};

export function CouponManager({ initialCoupons }: { initialCoupons: Coupon[] }) {
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const isExpired = (iso: string) => new Date(iso) < new Date();

  async function createCoupon() {
    if (!form.code.trim()) return toast.error("Code is required");
    if (form.type === "user" && !form.targetUserId.trim()) return toast.error("User ID is required for user-level coupons");
    setSaving(true);
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        applicablePlans: form.applicablePlans
          ? form.applicablePlans.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      }),
    });
    setSaving(false);
    if (res.ok) {
      const json = await res.json();
      const c = json.coupon;
      setCoupons((prev) => [{
        id: c._id,
        code: c.code, type: c.type, targetUserId: c.targetUserId,
        discountType: c.discountType, discountValue: c.discountValue,
        maxUses: c.maxUses, perUserLimit: c.perUserLimit, usedCount: c.usedCount,
        applicablePlans: c.applicablePlans, razorpayOfferId: c.razorpayOfferId || null,
        validFrom: c.validFrom, validTo: c.validTo, isActive: c.isActive,
        createdBy: c.createdBy, createdAt: c.createdAt,
      }, ...prev]);
      setForm(emptyForm);
      setShowForm(false);
      toast.success(`Coupon ${c.code} created`);
    } else {
      const json = await res.json();
      toast.error(json.error || "Failed to create coupon");
    }
  }

  async function toggleActive(id: string, current: boolean) {
    const res = await fetch(`/api/admin/coupons/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    if (res.ok) {
      setCoupons((prev) => prev.map((c) => c.id === id ? { ...c, isActive: !current } : c));
      toast.success(!current ? "Coupon activated" : "Coupon paused");
    }
  }

  async function deleteCoupon(id: string, code: string) {
    if (!confirm(`Delete coupon ${code}? This cannot be undone.`)) return;
    setDeletingId(id);
    const res = await fetch(`/api/admin/coupons/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (res.ok) {
      setCoupons((prev) => prev.filter((c) => c.id !== id));
      toast.success(`${code} deleted`);
    } else {
      toast.error("Failed to delete");
    }
  }

  return (
    <div className="space-y-6">
      {/* Create button */}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? "Cancel" : "New Coupon"}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs text-zinc-400">Code</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="LAUNCH50"
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white font-mono"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Type</Label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as "global" | "user" })}
                  className="mt-1 w-full rounded-md bg-zinc-800 border border-zinc-700 text-white text-sm px-3 py-2"
                >
                  <option value="global">Global (all users)</option>
                  <option value="user">User-level (specific user)</option>
                </select>
              </div>
              {form.type === "user" && (
                <div>
                  <Label className="text-xs text-zinc-400">Target User ID</Label>
                  <Input
                    value={form.targetUserId}
                    onChange={(e) => setForm({ ...form, targetUserId: e.target.value })}
                    placeholder="MongoDB ObjectId"
                    className="mt-1 bg-zinc-800 border-zinc-700 text-white font-mono text-xs"
                  />
                </div>
              )}
              <div>
                <Label className="text-xs text-zinc-400">Discount Type</Label>
                <select
                  value={form.discountType}
                  onChange={(e) => setForm({ ...form, discountType: e.target.value as "percent" | "flat" })}
                  className="mt-1 w-full rounded-md bg-zinc-800 border border-zinc-700 text-white text-sm px-3 py-2"
                >
                  <option value="percent">Percentage (%)</option>
                  <option value="flat">Flat amount (₹)</option>
                </select>
              </div>
              <div>
                <Label className="text-xs text-zinc-400">
                  {form.discountType === "percent" ? "Discount %" : "Discount ₹"}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={form.discountType === "percent" ? 100 : undefined}
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Max Uses (0 = unlimited)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.maxUses}
                  onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })}
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Per-user Limit</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.perUserLimit}
                  onChange={(e) => setForm({ ...form, perUserLimit: Number(e.target.value) })}
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Valid From</Label>
                <Input
                  type="date"
                  value={form.validFrom}
                  onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Valid To</Label>
                <Input
                  type="date"
                  value={form.validTo}
                  onChange={(e) => setForm({ ...form, validTo: e.target.value })}
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-zinc-400">Applicable Plans (slugs, comma-sep; empty = all)</Label>
                <Input
                  value={form.applicablePlans}
                  onChange={(e) => setForm({ ...form, applicablePlans: e.target.value })}
                  placeholder="basic, pro, plus, max"
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-zinc-400">Razorpay Offer ID (for subscriptions)</Label>
                <Input
                  value={form.razorpayOfferId}
                  onChange={(e) => setForm({ ...form, razorpayOfferId: e.target.value })}
                  placeholder="offer_xxxxx (create on Razorpay Dashboard first)"
                  className="mt-1 bg-zinc-800 border-zinc-700 text-white font-mono text-xs"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Required for subscription discounts. Create the offer on the{" "}
                  <a href="https://dashboard.razorpay.com/app/offers" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">Razorpay Dashboard</a>
                  {" "}first, then paste the ID here.
                </p>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                />
                <Label className="text-xs text-zinc-400">Active on create</Label>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={createCoupon} disabled={saving} className="gap-1.5">
                <Save className="w-3.5 h-3.5" />
                {saving ? "Creating…" : "Create Coupon"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Coupons table */}
      {coupons.length === 0 ? (
        <p className="text-center text-zinc-500 text-sm py-12">No coupons yet. Create one above.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Uses</th>
                <th className="px-4 py-3">Plans</th>
                <th className="px-4 py-3">Validity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {coupons.map((c) => (
                <tr key={c.id} className="bg-zinc-950 hover:bg-zinc-900 transition-colors">
                  <td className="px-4 py-3 font-mono font-semibold text-white">{c.code}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.type === "global" ? "default" : "secondary"} className="text-xs">
                      {c.type === "global" ? "🌍 Global" : "👤 User"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-emerald-400 font-semibold">
                    {c.discountType === "percent" ? `${c.discountValue}%` : `₹${c.discountValue}`} off
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {c.usedCount}{c.maxUses > 0 ? ` / ${c.maxUses}` : " / ∞"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {c.applicablePlans.length > 0 ? c.applicablePlans.join(", ") : "All"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {fmt(c.validFrom)} → {fmt(c.validTo)}
                    {isExpired(c.validTo) && (
                      <span className="ml-1 text-red-400">(expired)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={c.isActive}
                      onCheckedChange={() => toggleActive(c.id, c.isActive)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-950"
                      onClick={() => deleteCoupon(c.id, c.code)}
                      disabled={deletingId === c.id}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
