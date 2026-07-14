"use client";

import { useCallback, useEffect, useState } from "react";

interface WebhookRow {
  id: string;
  eventId: string;
  eventType: string;
  gateway: string;
  status: "pending" | "processed" | "failed" | "ignored";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  processed: "text-green-400",
  pending: "text-yellow-400",
  failed: "text-red-400",
  ignored: "text-zinc-500",
};

export default function WebhookMonitorPage() {
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [selected, setSelected] = useState<{
    id: string;
    payload: unknown;
  } | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (eventType) params.set("eventType", eventType);
    const res = await fetch(`/api/admin/billing/webhooks?${params}`);
    const data = await res.json();
    setRows(data.rows || []);
  }, [status, eventType]);

  useEffect(() => {
    void load();
  }, [load]);

  async function viewPayload(id: string) {
    const res = await fetch(`/api/admin/billing/webhooks/${id}`);
    const data = await res.json();
    setSelected({ id, payload: data.payload });
  }

  async function replay(id: string) {
    setReplaying(id);
    try {
      await fetch(`/api/admin/billing/webhooks/${id}/replay`, {
        method: "POST",
      });
      await load();
    } finally {
      setReplaying(null);
    }
  }

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Webhook Monitor</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Razorpay events received. Replay re-runs the handler safely — every
          handler is idempotent.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="processed">Processed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="ignored">Ignored</option>
        </select>
        <input
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          placeholder="Event type (e.g., subscription.charged)"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <button
          onClick={() => void load()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/80">
                <td className="px-4 py-3 text-zinc-300">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <code className="rounded bg-zinc-800 px-1 text-xs">
                    {r.eventType}
                  </code>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {r.eventId}
                  </div>
                </td>
                <td className={`px-4 py-3 ${STATUS_COLORS[r.status] ?? ""}`}>
                  {r.status}
                </td>
                <td className="px-4 py-3 text-xs text-red-300">
                  {r.errorMessage ?? "—"}
                </td>
                <td className="px-4 py-3 space-x-2">
                  <button
                    onClick={() => void viewPayload(r.id)}
                    className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
                  >
                    View
                  </button>
                  <button
                    onClick={() => void replay(r.id)}
                    disabled={replaying === r.id}
                    className="rounded-md border border-blue-500/30 px-3 py-1 text-xs text-blue-300 disabled:opacity-50"
                  >
                    {replaying === r.id ? "Replaying…" : "Replay"}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  No webhooks recorded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-300">
                Payload — {selected.id}
              </p>
              <button
                onClick={() => setSelected(null)}
                className="text-sm text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <pre className="text-xs text-zinc-200 whitespace-pre-wrap">
              {JSON.stringify(selected.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
