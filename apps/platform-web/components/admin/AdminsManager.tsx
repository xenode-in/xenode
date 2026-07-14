"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Shield } from "lucide-react";

interface AdminRecord {
  id: string;
  username: string;
  role: "super_admin" | "admin";
  isActive: boolean;
  createdBy?: string;
  lastLoginAt?: string;
  createdAt: string;
}

export function AdminsManager() {
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "admin" as "admin" | "super_admin" });
  const [formError, setFormError] = useState("");

  async function loadAdmins() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/admins");
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setAdmins(data.admins);
    } catch {
      setError("Failed to load admins");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAdmins(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setCreating(true);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
        return;
      }
      setForm({ username: "", password: "", role: "admin" });
      setShowCreate(false);
      loadAdmins();
    } catch {
      setFormError("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(admin: AdminRecord) {
    await fetch(`/api/admin/admins/${admin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !admin.isActive }),
    });
    loadAdmins();
  }

  async function handleDelete(admin: AdminRecord) {
    if (!confirm(`Delete admin "${admin.username}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/admins/${admin.id}`, { method: "DELETE" });
    loadAdmins();
  }

  return (
    <div className="space-y-4">
      {/* Create button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-100 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Admin
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-4">Create Admin Account</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                placeholder="john_admin"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                placeholder="Min 8 characters"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "super_admin" })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            {formError && (
              <div className="sm:col-span-3">
                <p className="text-red-400 text-sm">{formError}</p>
              </div>
            )}
            <div className="sm:col-span-3 flex gap-3">
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 transition-colors"
              >
                {creating ? "Creating…" : "Create Admin"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admins list */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="w-5 h-5 border-2 border-zinc-600 border-t-white rounded-full animate-spin mx-auto" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-400 text-sm">{error}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Created By</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Last Login</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Shield className={`w-3.5 h-3.5 ${admin.role === "super_admin" ? "text-amber-400" : "text-blue-400"}`} />
                      <span className="text-white font-medium">{admin.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      admin.role === "super_admin"
                        ? "bg-amber-400/10 text-amber-400"
                        : "bg-blue-400/10 text-blue-400"
                    }`}>
                      {admin.role === "super_admin" ? "Super Admin" : "Admin"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      admin.isActive
                        ? "bg-emerald-400/10 text-emerald-400"
                        : "bg-zinc-700 text-zinc-400"
                    }`}>
                      {admin.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{admin.createdBy || "—"}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => handleToggle(admin)}
                        className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                        title={admin.isActive ? "Deactivate" : "Activate"}
                      >
                        {admin.isActive
                          ? <ToggleRight className="w-4 h-4 text-emerald-400" />
                          : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(admin)}
                        className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
