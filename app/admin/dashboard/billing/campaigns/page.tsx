"use client";

import { useCallback, useEffect, useState } from "react";

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  discountPercent: number | null;
  flatDiscountPaise: number | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  badge: string;
  duration: "forever" | "limited";
  cycles: number | null;
  targetAudience: string;
  applicablePlans: string[];
  applicableCycles: string[];
  razorpayOfferId: string | null;
  priority: number;
  maxRedemptions: number | null;
  redeemedCount: number;
}

const EMPTY = {
  name: "",
  slug: "",
  discountPercent: 10,
  flatDiscountPaise: "",
  startsAt: new Date().toISOString().slice(0, 10),
  endsAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  badge: "",
  duration: "limited" as "forever" | "limited",
  cycles: 1,
  targetAudience: "all",
  applicablePlans: "",
  applicableCycles: "",
  razorpayOfferId: "",
  priority: 100,
  maxRedemptions: "",
};

export default function CampaignsAdminPage() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [result, setResult] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/billing/campaigns");
    const data = await res.json();
    setRows(data.rows || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setCreating(true);
    setResult("");
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        slug: form.slug,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        isActive: true,
        badge: form.badge || undefined,
        duration: form.duration,
        cycles: form.duration === "limited" ? Number(form.cycles) : undefined,
        targetAudience: form.targetAudience,
        applicablePlans: form.applicablePlans
          ? form.applicablePlans
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        applicableCycles: form.applicableCycles
          ? form.applicableCycles
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        razorpayOfferId: form.razorpayOfferId || undefined,
        priority: Number(form.priority),
        maxRedemptions: form.maxRedemptions
          ? Number(form.maxRedemptions)
          : undefined,
      };
      if (form.flatDiscountPaise) {
        body.flatDiscountPaise = Number(form.flatDiscountPaise);
      } else {
        body.discountPercent = Number(form.discountPercent);
      }
      const res = await fetch("/api/admin/billing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResult(`✅ Created ${data.id}`);
      setForm(EMPTY);
      await load();
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(id: string, isActive: boolean) {
    await fetch(`/api/admin/billing/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    await load();
  }

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <p className="mt-1 text-sm text-zinc-400">
          First-class promotion records. Highest priority (lowest number) wins
          when multiple match.
        </p>
      </div>

      {result && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm">
          {result}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">
          New campaign
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="slug (lowercase, dash-separated)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono"
          />
          <input
            type="number"
            value={form.discountPercent}
            onChange={(e) =>
              setForm({ ...form, discountPercent: Number(e.target.value) })
            }
            placeholder="% off (or use flat below)"
            min={1}
            max={99}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.flatDiscountPaise}
            onChange={(e) =>
              setForm({ ...form, flatDiscountPaise: e.target.value })
            }
            placeholder="Flat discount (paise) — leave blank for %"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <select
            value={form.duration}
            onChange={(e) =>
              setForm({
                ...form,
                duration: e.target.value as "forever" | "limited",
              })
            }
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="limited">Limited (N cycles)</option>
            <option value="forever">Forever (lifetime lock-in)</option>
          </select>
          <input
            type="number"
            value={form.cycles}
            disabled={form.duration !== "limited"}
            onChange={(e) =>
              setForm({ ...form, cycles: Number(e.target.value) })
            }
            placeholder="# cycles (limited only)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-40"
          />
          <input
            value={form.targetAudience}
            onChange={(e) =>
              setForm({ ...form, targetAudience: e.target.value })
            }
            placeholder="targetAudience (all | free_only | plan:pro)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.applicablePlans}
            onChange={(e) =>
              setForm({ ...form, applicablePlans: e.target.value })
            }
            placeholder="applicablePlans (comma-separated, blank = all)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.applicableCycles}
            onChange={(e) =>
              setForm({ ...form, applicableCycles: e.target.value })
            }
            placeholder="applicableCycles (monthly,yearly — blank = all)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.razorpayOfferId}
            onChange={(e) =>
              setForm({ ...form, razorpayOfferId: e.target.value })
            }
            placeholder="Razorpay offer_id (optional)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono"
          />
          <input
            type="number"
            value={form.priority}
            onChange={(e) =>
              setForm({ ...form, priority: Number(e.target.value) })
            }
            placeholder="priority (lower wins)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.maxRedemptions}
            onChange={(e) =>
              setForm({ ...form, maxRedemptions: e.target.value })
            }
            placeholder="maxRedemptions (blank = uncapped)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.badge}
            onChange={(e) => setForm({ ...form, badge: e.target.value })}
            placeholder="UI badge (e.g., LAUNCH)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => void create()}
          disabled={creating || !form.name || !form.slug}
          className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create campaign"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Window</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Redeemed</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/80">
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.slug}</td>
                <td className="px-4 py-3">
                  {r.discountPercent
                    ? `${r.discountPercent}%`
                    : r.flatDiscountPaise
                      ? `Rs.${(r.flatDiscountPaise / 100).toFixed(0)}`
                      : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-400">
                  {new Date(r.startsAt).toLocaleDateString()} –{" "}
                  {new Date(r.endsAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 font-mono">{r.priority}</td>
                <td className="px-4 py-3 font-mono">
                  {r.redeemedCount}
                  {r.maxRedemptions ? ` / ${r.maxRedemptions}` : ""}
                </td>
                <td className="px-4 py-3">
                  {r.isActive ? (
                    <span className="text-green-400">Active</span>
                  ) : (
                    <span className="text-zinc-500">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void toggle(r.id, !r.isActive)}
                    className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
                  >
                    {r.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-zinc-500">
                  No campaigns yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
