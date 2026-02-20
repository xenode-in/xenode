import { requireAuth } from "@/lib/auth/session";
import { Shield, User, Mail, Calendar, Palette } from "lucide-react";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { EncryptionSettingsSection } from "@/components/settings/EncryptionSettingsSection";

export default async function SettingsPage() {
  const session = await requireAuth();
  const user = session.user;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account settings
        </p>
      </div>

      {/* Appearance */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary" />
          Appearance
        </h3>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-foreground mb-4">Theme</p>
            <ThemeSelector />
          </div>
        </div>
      </div>

      {/* Profile */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          Profile
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="text-sm text-foreground mt-0.5">{user.name}</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Mail className="w-3 h-3" />
                Email
              </p>
              <p className="text-sm text-foreground mt-0.5">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Member Since
              </p>
              <p className="text-sm text-foreground mt-0.5">
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
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          Security
        </h3>
        <div className="space-y-4">
          <EncryptionSettingsSection />
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm text-foreground">Password</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Change your account password
              </p>
            </div>
            <span className="text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg">
              Coming Soon
            </span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm text-foreground">
                Two-Factor Authentication
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add an extra layer of security
              </p>
            </div>
            <span className="text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg">
              Coming Soon
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-foreground">Connected Accounts</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage linked OAuth providers
              </p>
            </div>
            <span className="text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg">
              Coming Soon
            </span>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-card border border-destructive/20 rounded-xl p-6">
        <h3 className="text-sm font-medium text-destructive mb-4">
          Danger Zone
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-foreground">Delete Account</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently delete your account and all associated data
            </p>
          </div>
          <span className="text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg">
            Coming Soon
          </span>
        </div>
      </div>
    </div>
  );
}
