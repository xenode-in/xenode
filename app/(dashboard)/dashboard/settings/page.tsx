import { requireAuth } from "@/lib/auth/session";
import { Shield, User, Mail, Calendar } from "lucide-react";

export default async function SettingsPage() {
  const session = await requireAuth();
  const user = session.user;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#e8e4d9]">Settings</h1>
        <p className="text-sm text-[#e8e4d9]/50 mt-1">
          Manage your account settings
        </p>
      </div>

      {/* Profile */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-6">
        <h3 className="text-sm font-medium text-[#e8e4d9] mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-[#7cb686]" />
          Profile
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-sm text-[#e8e4d9]/60">Name</p>
              <p className="text-sm text-[#e8e4d9] mt-0.5">{user.name}</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-sm text-[#e8e4d9]/60 flex items-center gap-1">
                <Mail className="w-3 h-3" />
                Email
              </p>
              <p className="text-sm text-[#e8e4d9] mt-0.5">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-[#e8e4d9]/60 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Member Since
              </p>
              <p className="text-sm text-[#e8e4d9] mt-0.5">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })
                  : "N/A"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="bg-[#1a2e1d]/50 border border-white/5 rounded-xl p-6">
        <h3 className="text-sm font-medium text-[#e8e4d9] mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#7cb686]" />
          Security
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-sm text-[#e8e4d9]">Password</p>
              <p className="text-xs text-[#e8e4d9]/40 mt-0.5">
                Change your account password
              </p>
            </div>
            <span className="text-xs text-[#e8e4d9]/30 bg-white/5 px-3 py-1.5 rounded-lg">
              Coming Soon
            </span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-sm text-[#e8e4d9]">
                Two-Factor Authentication
              </p>
              <p className="text-xs text-[#e8e4d9]/40 mt-0.5">
                Add an extra layer of security
              </p>
            </div>
            <span className="text-xs text-[#e8e4d9]/30 bg-white/5 px-3 py-1.5 rounded-lg">
              Coming Soon
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-[#e8e4d9]">Connected Accounts</p>
              <p className="text-xs text-[#e8e4d9]/40 mt-0.5">
                Manage linked OAuth providers
              </p>
            </div>
            <span className="text-xs text-[#e8e4d9]/30 bg-white/5 px-3 py-1.5 rounded-lg">
              Coming Soon
            </span>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-[#1a2e1d]/50 border border-red-400/10 rounded-xl p-6">
        <h3 className="text-sm font-medium text-red-400 mb-4">Danger Zone</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#e8e4d9]">Delete Account</p>
            <p className="text-xs text-[#e8e4d9]/40 mt-0.5">
              Permanently delete your account and all associated data
            </p>
          </div>
          <span className="text-xs text-[#e8e4d9]/30 bg-white/5 px-3 py-1.5 rounded-lg">
            Coming Soon
          </span>
        </div>
      </div>
    </div>
  );
}
