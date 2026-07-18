import { requireAuth } from "@/lib/auth/session";
import { Shield, User, Mail, Calendar, Palette, HardDrive, ExternalLink } from "lucide-react";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { PreviewCacheSection } from "@/components/settings/PreviewCacheSection";

const ACCOUNTS_ORIGIN =
  process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? "https://accounts.xenode.in";

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
        <ThemeSelector />
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
                <Mail className="w-3 h-3" /> Email
              </p>
              <p className="text-sm text-foreground mt-0.5">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Member Since
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
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-foreground">Account security</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Password, two-factor authentication, linked accounts, and
                device sessions are managed in your Xenode Account.
              </p>
            </div>
            <a
              href={ACCOUNTS_ORIGIN}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary flex items-center gap-1 bg-secondary px-3 py-1.5 rounded-lg hover:bg-secondary/80"
            >
              Manage account <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-primary" />
          Storage
        </h3>
        <PreviewCacheSection />
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
