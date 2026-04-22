"use client";

import { useEffect, useState } from "react";

interface OfferRow {
  _id: string;
  name: string;
  discountPercent: number;
  discountedAmount: number;
  razorpayOfferId: string;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  usageCount: number;
}

export default function SubscriptionOffersPage() {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [activeOffer, setActiveOffer] = useState<OfferRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState("");
  const [form, setForm] = useState({
    name: "",
    discountPercent: 50,
    razorpayOfferId: "",
    validFrom: new Date().toISOString().slice(0, 10),
    validUntil: "",
  });

  async function loadData() {
    const response = await fetch("/api/admin/subscriptions/offers");
    const data = await response.json();
    setOffers(data.offers || []);
    setActiveOffer(data.activeOffer || null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function createOffer() {
    if (!form.razorpayOfferId.startsWith("offer_")) {
      setResult(
        "❌ razorpayOfferId must start with 'offer_'. Create the offer on the Razorpay Dashboard first.",
      );
      return;
    }
    setCreating(true);
    setResult("");
    try {
      const response = await fetch("/api/admin/subscriptions/offers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (data.offer) {
        setResult("✅ Offer created successfully");
        setForm({
          name: "",
          discountPercent: 50,
          razorpayOfferId: "",
          validFrom: new Date().toISOString().slice(0, 10),
          validUntil: "",
        });
        await loadData();
      } else {
        setResult(`❌ ${data.error || "Failed"}`);
      }
    } catch {
      setResult("❌ Request failed");
    }
    setCreating(false);
  }

  async function deactivateOffer(id: string) {
    await fetch(`/api/admin/subscriptions/offers/${id}/deactivate`, {
      method: "POST",
    });
    await loadData();
  }

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Subscription Offers</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Link Razorpay Offers (created on the Dashboard) to your subscription
          flow. Only one active offer at a time.
        </p>
      </div>

      {/* Active offer card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-400">Active offer</p>
        {activeOffer ? (
          <div className="mt-2">
            <p className="text-lg font-semibold">
              {activeOffer.name} ({activeOffer.discountPercent}% off)
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Razorpay Offer ID:{" "}
              <code className="rounded bg-zinc-800 px-1">
                {activeOffer.razorpayOfferId}
              </code>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-lg font-semibold text-zinc-500">
            No active offer
          </p>
        )}
      </div>

      {result && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm">
          {result}
        </div>
      )}

      {/* Create offer form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">
          Create new offer
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          First create the offer on the{" "}
          <a
            href="https://dashboard.razorpay.com/app/offers"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline"
          >
            Razorpay Dashboard
          </a>
          , then paste the Offer ID below.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="Offer name (e.g., Launch Offer)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <input
            value={form.razorpayOfferId}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                razorpayOfferId: e.target.value,
              }))
            }
            placeholder="Razorpay Offer ID (offer_xxxxx)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono"
          />
          <input
            type="number"
            value={form.discountPercent}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                discountPercent: Number(e.target.value),
              }))
            }
            placeholder="Discount %"
            min={1}
            max={99}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={form.validFrom}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, validFrom: e.target.value }))
              }
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, validUntil: e.target.value }))
              }
              placeholder="End (optional)"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <button
          onClick={() => void createOffer()}
          disabled={creating || !form.name || !form.razorpayOfferId}
          className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create offer"}
        </button>
      </div>

      {/* Offers table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Razorpay Offer ID</th>
              <th className="px-4 py-3">Window</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <tr key={offer._id} className="border-b border-zinc-800/80">
                <td className="px-4 py-3">{offer.name}</td>
                <td className="px-4 py-3">{offer.discountPercent}%</td>
                <td className="px-4 py-3">
                  <code className="rounded bg-zinc-800 px-1 text-xs">
                    {offer.razorpayOfferId}
                  </code>
                </td>
                <td className="px-4 py-3">
                  {new Date(offer.validFrom).toLocaleDateString()} –{" "}
                  {offer.validUntil
                    ? new Date(offer.validUntil).toLocaleDateString()
                    : "Open"}
                </td>
                <td className="px-4 py-3">
                  {offer.isActive ? (
                    <span className="text-green-400">Active</span>
                  ) : (
                    <span className="text-zinc-500">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {offer.isActive ? (
                    <button
                      onClick={() => void deactivateOffer(offer._id)}
                      className="rounded-md border border-red-500/30 px-3 py-1 text-xs text-red-300"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <span className="text-zinc-600 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
            {offers.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-zinc-500"
                >
                  No offers yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
