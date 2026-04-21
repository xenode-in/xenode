"use client";

import { useEffect, useState } from "react";

interface OfferRow {
  _id: string;
  name: string;
  discountPercent: number;
  discountedAmount: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  usageCount: number;
}

export default function SubscriptionOffersPage() {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [activeOffer, setActiveOffer] = useState<OfferRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    discountPercent: 50,
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
    await fetch("/api/admin/subscriptions/offers/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({
      name: "",
      discountPercent: 50,
      validFrom: new Date().toISOString().slice(0, 10),
      validUntil: "",
    });
    await loadData();
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
          Manage the one-time first-cycle discount offer and its usage.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-400">Active offer</p>
        <p className="mt-2 text-lg font-semibold">
          {activeOffer
            ? `${activeOffer.name} (${activeOffer.discountPercent}% off, Rs.${(
                activeOffer.discountedAmount / 100
              ).toFixed(2)})`
            : "No active offer"}
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 md:grid-cols-4">
        <input
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="Offer name"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={form.discountPercent}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, discountPercent: Number(event.target.value) }))
          }
          placeholder="Discount %"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={form.validFrom}
          onChange={(event) => setForm((prev) => ({ ...prev, validFrom: event.target.value }))}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={form.validUntil}
          onChange={(event) => setForm((prev) => ({ ...prev, validUntil: event.target.value }))}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
        <button
          onClick={() => void createOffer()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black md:col-span-4"
        >
          Create offer
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">First cycle amount</th>
              <th className="px-4 py-3">Window</th>
              <th className="px-4 py-3">Usage</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <tr key={offer._id} className="border-b border-zinc-800/80">
                <td className="px-4 py-3">{offer.name}</td>
                <td className="px-4 py-3">{offer.discountPercent}%</td>
                <td className="px-4 py-3">Rs.{(offer.discountedAmount / 100).toFixed(2)}</td>
                <td className="px-4 py-3">
                  {new Date(offer.validFrom).toLocaleDateString()} -{" "}
                  {offer.validUntil ? new Date(offer.validUntil).toLocaleDateString() : "Open"}
                </td>
                <td className="px-4 py-3">{offer.usageCount}</td>
                <td className="px-4 py-3">
                  {offer.isActive ? (
                    <button
                      onClick={() => void deactivateOffer(offer._id)}
                      className="rounded-md border border-red-500/30 px-3 py-1 text-xs text-red-300"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <span className="text-zinc-500">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
