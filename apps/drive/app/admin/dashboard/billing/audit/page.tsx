"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

interface AuditRow {
  id: string;
  type: string;
  userId: string | null;
  actorType: "user" | "admin" | "system" | "webhook";
  actorId: string | null;
  subjectType: string;
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

const ACTOR_COLORS: Record<string, string> = {
  user: "text-blue-300",
  admin: "text-amber-300",
  system: "text-purple-300",
  webhook: "text-green-300",
};

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [type, setType] = useState("");
  const [actorType, setActorType] = useState("");
  const [userId, setUserId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (actorType) params.set("actorType", actorType);
    if (userId) params.set("userId", userId);
    const res = await fetch(`/api/admin/billing/audit?${params}`);
    const data = await res.json();
    setRows(data.rows || []);
  }, [type, actorType, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">Billing Audit Log</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every billing-domain state transition. Append-only. Last 30 days by
          default.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="event type (e.g., subscription.charged)"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <select
          value={actorType}
          onChange={(e) => setActorType(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="">Any actor</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="system">System</option>
          <option value="webhook">Webhook</option>
        </select>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="userId"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-mono"
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
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr
                  className="border-b border-zinc-800/80 cursor-pointer hover:bg-zinc-800/40"
                  onClick={() =>
                    setExpanded(expanded === r.id ? null : r.id)
                  }
                >
                  <td className="px-4 py-3 text-xs text-zinc-300">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.type}</td>
                  <td
                    className={`px-4 py-3 ${ACTOR_COLORS[r.actorType] ?? ""}`}
                  >
                    {r.actorType}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <code className="rounded bg-zinc-800 px-1">
                      {r.subjectType}
                    </code>
                    {r.subjectId && (
                      <span className="ml-1 text-zinc-500">
                        {r.subjectId.slice(0, 24)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {r.userId ?? "—"}
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr className="bg-zinc-950">
                    <td colSpan={5} className="px-4 py-3">
                      <pre className="text-xs text-zinc-300 whitespace-pre-wrap">
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  No events
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
